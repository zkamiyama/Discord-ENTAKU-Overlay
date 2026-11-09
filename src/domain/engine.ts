import {adjacentSeats} from '../geometry/seat-relations.ts';
import {seatingSession,validatePreset,type ParameterPreset,type SeatingPreset} from '../presets/schema.ts';
import {DEFAULT_DIRECTION} from '../studio/direction.ts';
import { protectStudioCamera } from '../studio/camera-safety.ts';
import { DEFAULT_STUDIO_SCENE, validateStudioScene, type StudioScene } from '../studio/manifest.ts';
import { validateProfile, avatarFramingBounds, avatarEnvelopeBounds, requiredAvatarPitch, type AvatarProfile } from '../assets/avatar-profile.ts';
import type { AppSnapshot, CameraPlan, Channel, ConnectionStatus, Decision, DirectorMode, Participant, ProviderEvent, SeatSession, SeatTransform, Shot } from '../contracts/domain.ts';
import { TABLE } from './defaults.ts';
import { makeLayout, makeSessionLayout } from '../geometry/capsule.ts';
import { newSession, SeatAllocator } from './seat-allocator.ts';
import { SpeakerTracker } from './speaker-tracker.ts';
import { ShotDirector } from './shot-director.ts';
import { moderatorRearLimit, pairPose, planCamera, widePose, wideFaces, fitsCameraFrame, avatarFramePoints, type AvatarExtent } from './camera-planner.ts';

export interface EngineOptions {
  source: AppSnapshot['source'];
  seatingDefaults?:SeatingPreset; autoCamera?:boolean;
  serverEpoch: string;
  sessions?: SeatSession[];
  avatarProfiles?: AvatarProfile[];
  studio?: StudioScene;
  utcNow?: () => string;
  sessionId?: () => string;
}
export class AppEngine {
  private splitCache=new Map<string,boolean>();private splitSignature="";
  private observers=new Set<(event:ProviderEvent,processingMs:number)=>void>();
  private studio: StudioScene;
  private profiles = new Map<string,AvatarProfile>();
  private participants = new Map<string, Participant>();
  private allocators = new Map<string, SeatAllocator>();
  private allocator = new SeatAllocator(newSession('0', 'unbound'));
  private tracker = new SpeakerTracker();
  private director = new ShotDirector();
  private channel: Channel | null = null;
  private connection: ConnectionStatus = 'disconnected';
  private error?: string;
  private generation = -1;
  private now = 0;
  private seq = 0;
  private revision = 0;
  private pending = new Map<string, { state: 'active' | 'inactive'; expires: number }>();
  private layout = makeLayout(TABLE.minSeats);
  private layoutMotion?: AppSnapshot['layoutMotion'];
  private layoutHoldUntil = -Infinity;
  private layoutHoldReason='LAYOUT_GROWTH';
  private membershipDue: number | null = null;
  private pendingManual: Shot | null = null;
  private camera: CameraPlan;
  private decision: Decision = { shot: { kind: 'WIDE', userIds: [] }, reason: 'SOURCE_LOST', changed: false, holdRemainingMs: 0 };

  constructor(private options: EngineOptions) {
    this.studio=validateStudioScene(options.studio??DEFAULT_STUDIO_SCENE);
    this.configureDirection();
    if(options.autoCamera===false)this.director.setMode('HOLD');
    for (const session of options.sessions ?? []) this.allocators.set(session.channelId, new SeatAllocator(session));
    for(const profile of options.avatarProfiles??[]){const clean=validateProfile(profile);this.profiles.set(clean.userId,clean);}
    const pose = widePose(0,this.avatarExtents().values());
    this.camera = { id: 0, shot: { kind: 'WIDE', userIds: [] }, reason: 'BOOT', transition: 'CUT', from: pose, to: pose, startMs: 0, durationMs: 0 };
  }
  private advance(now: number): void {
    if (!Number.isFinite(now) || now < 0) throw new Error('INVALID_TIME');
    // Provider receive timestamps may predate a timer tick. Never rewind the domain clock.
    this.now = Math.max(this.now, now);
  }
  private clearSpeech(stale: boolean): void {
    this.tracker.clear(); this.pending.clear(); this.pendingManual=null;
    for (const participant of this.participants.values()) {
      participant.speaking = 'unknown';
      if (stale && participant.presence === 'present') participant.presence = 'stale';
    }
  }
  apply(event: ProviderEvent, processingMs = event.receivedAtMs): boolean {
    if (event.sourceGeneration < this.generation) return false;
    this.advance(processingMs);
    if (event.sourceGeneration > this.generation) {
      this.generation = event.sourceGeneration;
      this.clearSpeech(true);
      this.connection = 'syncing';
    }
    switch (event.type) {
      case 'connection':
        this.connection = event.status; this.error = event.errorCode;
        if (['disconnected', 'discovering', 'degraded', 'auth-required'].includes(event.status)) this.clearSpeech(true);
        break;
      case 'snapshot': {
        const nextId = event.channel?.channelId;
        const changedChannel = nextId !== this.channel?.channelId;
        if (changedChannel) {
          const auto=this.director.mode!=='HOLD';this.pendingManual=null; this.director.reset();this.director.setMode(auto?'AUTO':'HOLD'); this.clearSpeech(false); this.participants.clear(); this.membershipDue = null;
          if (nextId) {
            let allocator = this.allocators.get(nextId);
            if (!allocator) {
              allocator = new SeatAllocator(this.options.seatingDefaults?seatingSession(this.options.seatingDefaults,nextId,this.options.sessionId?.()??crypto.randomUUID()):newSession(nextId,this.options.sessionId?.()??crypto.randomUUID()));
              this.allocators.set(nextId, allocator);
            }
            this.allocator = allocator;
            this.layout = makeSessionLayout(allocator.snapshot());
            this.layoutMotion = undefined;
            this.layoutHoldUntil = -Infinity;
            this.forceWide('CHANNEL_CHANGED');
          }
        }
        this.channel = event.channel;
        const currentIds = new Set(event.participants.map(p => p.userId));
        for (const p of this.participants.values()) if (!currentIds.has(p.userId)) {
          p.presence = 'absent'; p.speaking = 'unknown'; this.tracker.update(p.userId, 'unknown', this.now);
        }
        for (const p of event.participants) this.upsert(p);
        this.allocate();
        break;
      }
      case 'participant-upsert':
        if (event.participant.channelId !== this.channel?.channelId) return false;
        this.upsert(event.participant);
        this.membershipDue ??= this.now + 500;
        break;
      case 'participant-left': {
        const p = this.participants.get(event.userId);
        if (p) { p.presence = 'absent'; p.speaking = 'unknown'; this.tracker.update(p.userId, 'unknown', this.now); }
        this.pending.delete(event.userId);
        this.membershipDue ??= this.now + 500;
        break;
      }
      case 'speaking': {
        const p = this.participants.get(event.userId);
        if (p?.presence === 'present') { p.speaking = event.state; this.tracker.update(p.userId, event.state, this.now); }
        else if (!p && this.pending.size < 1024) this.pending.set(event.userId, { state: event.state, expires: this.now + 5000 });
        break;
      }
    }
    this.seq++;
    this.tick(this.now);
    for(const observer of this.observers)observer(structuredClone(event),this.now);
    return true;
  }
  private upsert(incoming: Participant): void {
    const existing = this.participants.get(incoming.userId);
    const speaking = existing?.presence === 'present' ? existing.speaking : 'unknown';
    this.participants.set(incoming.userId, { ...structuredClone(incoming), presence: 'present', speaking });
    const pending = this.pending.get(incoming.userId);
    if (pending) {
      this.pending.delete(incoming.userId);
      if (pending.expires >= this.now) {
        this.participants.get(incoming.userId)!.speaking = pending.state;
        // Conservative: do not invent historical active time before membership was known.
        this.tracker.update(incoming.userId, pending.state, this.now);
      }
    }
  }
  private presentIds(): string[] {
    return [...this.participants.values()].filter(p => p.presence === 'present').map(p => p.userId);
  }
  private allocate(): void {
    const oldLayout=this.layout;
    const saved=this.allocator.snapshot();
    if(saved.reservations.length)this.allocator.lockGrowthAnchor(makeSessionLayout(saved).straightLength);
    this.allocator.updatePresent(this.presentIds(),this.options.utcNow?.()??new Date().toISOString());
    const pitch=Math.max(TABLE.seatPitch,...this.allocator.snapshot().reservations.map(r=>{const p=this.profiles.get(r.userId);return p?requiredAvatarPitch(p):TABLE.seatPitch;}));
    this.allocator.expandPitch(pitch);
    const next=makeSessionLayout(this.allocator.snapshot());
    if(this.allocator.snapshot().reservations.length)this.allocator.lockGrowthAnchor(next.straightLength);
    this.allocator.retainLength(next.straightLength);
    if(JSON.stringify(next)!==JSON.stringify(oldLayout)){
      this.layout=next;
      this.layoutMotion={fromSeats:oldLayout.seats,fromStraightLength:oldLayout.straightLength,fromDeskOffsetZ:oldLayout.offsetZ??0,startMs:this.now,durationMs:TABLE.growthDurationMs};
      this.layoutHoldUntil=this.now+TABLE.growthDurationMs+500;this.layoutHoldReason='LAYOUT_GROWTH';
      this.forceWide('LAYOUT_GROWTH');
    }
    this.membershipDue=null;
  }
  private byUser(): Map<string, SeatTransform> {
    return new Map(this.allocator.snapshot().reservations.filter(r=>this.participants.get(r.userId)?.presence==='present').map(r => {
      const seat=this.layout.seats[r.slotIndex]!,profile=this.profiles.get(r.userId);
      if(!profile)return [r.userId,seat];
      const yaw=seat.baseYawRad;
      return [r.userId,{...seat,faceAnchor:[seat.faceAnchor[0]+Math.cos(yaw)*profile.offsetX,seat.faceAnchor[1]+profile.offsetY,seat.faceAnchor[2]-Math.sin(yaw)*profile.offsetX] as const}];
    }));
  }
  private avatarExtents(): Map<string,AvatarExtent> {
    return new Map([...this.profiles].map(([id,p])=>{const b=avatarFramingBounds(p),body=avatarEnvelopeBounds(p);return [id,{bodyHalfWidth:Math.max(-body.left,body.right),bodyTopY:1.25+p.offsetY+body.top,bodyBottomY:Math.max(0,1.25+p.offsetY+body.bottom),faceHalfHeight:.14*p.scale,faceHalfWidth:.14*p.scale*(p.faceRect[2]*p.image.width)/(p.faceRect[3]*p.image.height),halfWidth:Math.max(-b.left,b.right)+Math.abs(p.offsetX),topY:1.25+p.offsetY+b.top,bottomY:Math.max(0,1.25+p.offsetY+b.bottom)}];}));
  }
  setAvatarProfiles(profiles: readonly AvatarProfile[], expectedRevision: number, now: number): void {
    if(expectedRevision!==this.revision)throw new Error('REVISION_CONFLICT');
    const clean=profiles.map(validateProfile);
    if(new Set(clean.map(p=>p.userId)).size!==clean.length)throw new Error('INVALID_AVATAR_PROFILE');
    this.advance(now);this.profiles=new Map(clean.map(p=>[p.userId,p]));
    this.revision++;this.seq++;this.pendingManual=null;this.director.reset();this.layoutHoldUntil=this.now+500;this.allocate();
    this.layoutHoldReason='AVATAR_CHANGED';this.forceWide('AVATAR_CHANGED');this.tick(this.now);
  }
  private configureDirection():void {
    const d=this.studio.direction??DEFAULT_DIRECTION;this.tracker.configure(d);this.director.configure(d);
  }
  setStudioScene(scene: StudioScene, expectedRevision: number, now: number): void {
    if(expectedRevision!==this.revision)throw new Error('REVISION_CONFLICT');
    const clean=validateStudioScene(scene);this.advance(now);
    const geometry=(s:StudioScene)=>JSON.stringify({...s,revision:0,exposure:undefined,quality:undefined,post:undefined,direction:undefined});
    const previous=this.studio.direction??DEFAULT_DIRECTION,next=clean.direction??DEFAULT_DIRECTION;
    const framingChanged=['portraitFov','wideHeightRatio','nearClip'].some(key=>previous[key as keyof typeof previous]!==next[key as keyof typeof next]);
    const directionChanged=JSON.stringify(previous)!==JSON.stringify(next);
    const exposureOnly=geometry(clean)===geometry(this.studio);this.studio=clean;this.configureDirection();
    if(exposureOnly){
      this.revision++;this.seq++;
      if(framingChanged){
        // Parameter edits are manual operations: reframe the current shot now,
        // preserving AUTO/HOLD and its manual lease instead of waiting for speech.
        this.camera=this.protect(planCamera(this.camera,this.camera.shot,'CAMERA_SETTINGS_CHANGED',this.byUser(),this.allocator.snapshot().capacity,this.layout.straightLength,this.now,this.avatarExtents(),this.layout.offsetZ??0,next));
      }
      if(directionChanged)this.tick(this.now);
      return;
    }
    this.revision++;this.seq++;this.pendingManual=null;this.director.reset();
    this.layoutHoldUntil=this.now+1000;this.layoutHoldReason='STUDIO_CHANGED';
    this.forceWide('STUDIO_CHANGED');this.tick(this.now);
  }
  applyPreset(input:ParameterPreset,expectedRevision:number,now:number):void {
    if(expectedRevision!==this.revision)throw new Error('REVISION_CONFLICT');
    const p=validatePreset(input);
    const next=new SeatAllocator(seatingSession(p.seating,this.channel?.channelId??'0',crypto.randomUUID()));
    next.updatePresent(this.presentIds(),this.options.utcNow?.()??new Date().toISOString());
    // Validate the entire replacement before touching the active state.
    makeSessionLayout(next.snapshot());this.advance(now);
    this.studio={...p.studio,revision:input.studio.revision};this.configureDirection();this.profiles=new Map(p.avatarProfiles.map(a=>[a.userId,a]));
    this.options.seatingDefaults=p.seating;this.options.autoCamera=p.autoCamera;this.allocator=next;
    if(this.channel)this.allocators.set(this.channel.channelId,next);
    this.layout=makeSessionLayout(next.snapshot());this.allocate();this.layoutMotion=undefined;
    this.pendingManual=null;this.director.reset();this.director.setMode(p.autoCamera?'AUTO':'HOLD');
    this.layoutHoldUntil=this.now+1000;this.layoutHoldReason='PRESET_APPLIED';this.forceWide('PRESET_APPLIED');
    this.revision++;this.seq++;this.tick(this.now);
  }
  private protect(plan:CameraPlan):CameraPlan{
    const extents=this.avatarExtents();
    const points=[...this.byUser()].flatMap(([id,seat])=>avatarFramePoints(seat,extents.get(id)??{halfWidth:.35,topY:1.6,bottomY:.85}));
    return protectStudioCamera(plan,this.studio,widePose(this.layout.straightLength,extents.values(),this.layout.offsetZ??0,(this.studio.direction??DEFAULT_DIRECTION).wideHeightRatio,wideFaces(this.byUser(),extents),(this.studio.direction??DEFAULT_DIRECTION).nearClip),pose=>pose.position[2]>=moderatorRearLimit(this.layout.straightLength,this.layout.offsetZ??0)&&Math.abs(pose.position[0])<1e-6&&Math.abs(pose.target[0])<1e-6&&fitsCameraFrame(pose,points,.90,(this.studio.direction??DEFAULT_DIRECTION).nearClip));
  }
  private forceWide(reason: string): void {
    this.camera = this.protect(planCamera(this.camera, { kind: 'WIDE', userIds: [] }, reason, this.byUser(), this.allocator.snapshot().capacity, this.layout.straightLength, this.now,this.avatarExtents(),this.layout.offsetZ??0,this.studio.direction??DEFAULT_DIRECTION));
  }
  tick(now: number): void {
    this.advance(now);
    for (const [id, item] of this.pending) if (item.expires < this.now) this.pending.delete(id);
    if (this.membershipDue !== null && this.now >= this.membershipDue) this.allocate();
    const byUser = this.byUser();
    const present = this.allocator.snapshot().reservations.filter(r => this.participants.get(r.userId)?.presence === 'present').sort((a, b) => a.slotIndex - b.slotIndex).map(r => r.userId);
    if(this.pendingManual&&this.connection==='ready'&&this.now>=this.layoutHoldUntil){
      const shot=this.pendingManual;this.pendingManual=null;
      if(shot.userIds.every(id=>present.includes(id))){
        const requested=this.director.manual(shot,this.now,this.studio.direction?.manualReturnSeconds??10);
        if(requested.changed)this.camera=this.protect(planCamera(this.camera,shot,requested.reason,byUser,this.allocator.snapshot().capacity,this.layout.straightLength,this.now,this.avatarExtents(),this.layout.offsetZ??0,this.studio.direction??DEFAULT_DIRECTION));
        this.seq++;
      }
    }
    const extents=this.avatarExtents();
    this.decision = this.director.update(this.now, this.tracker, {
      presentIds: present, sourceReady: this.connection === 'ready', layoutMoving: this.now < this.layoutHoldUntil, layoutReason:this.layoutHoldReason,
      splitEnabled:(this.studio.direction??DEFAULT_DIRECTION).splitEnabled,
      preferPair:(a,b)=>!!byUser.get(a)&&!!byUser.get(b)&&adjacentSeats(byUser.get(a)!,byUser.get(b)!),
      canSplit:(a,b)=>{
        if(byUser.get(a)&&byUser.get(b)&&adjacentSeats(byUser.get(a)!,byUser.get(b)!))return false;
        const signature=JSON.stringify([this.layout,[...byUser],[...extents],this.studio.direction,this.studio.camera,this.studio.tableAnchor]);
        if(signature!==this.splitSignature){this.splitCache.clear();this.splitSignature=signature;}
        const key=a+','+b;const cached=this.splitCache.get(key);if(cached!==undefined)return cached;
        const candidate=this.protect(planCamera(this.camera,{kind:'SPLIT',userIds:[a,b]},'SPLIT_FEASIBILITY',byUser,this.allocator.snapshot().capacity,this.layout.straightLength,this.now,extents,this.layout.offsetZ??0,this.studio.direction??DEFAULT_DIRECTION));
        const ok=candidate.shot.kind==='SPLIT';if(this.splitCache.size>=32)this.splitCache.delete(this.splitCache.keys().next().value!);this.splitCache.set(key,ok);return ok;
      },
      canPair: (a, b) => !!byUser.get(a) && !!byUser.get(b) && pairPose(byUser.get(a)!, byUser.get(b)!,[a,b].flatMap(id=>extents.has(id)?[extents.get(id)!]:[]),(this.studio.direction??DEFAULT_DIRECTION).portraitFov) !== null,
    });
    if (this.decision.changed) {
      this.camera = this.protect(planCamera(this.camera, this.decision.shot, this.decision.reason, byUser, this.allocator.snapshot().capacity, this.layout.straightLength, this.now,this.avatarExtents(),this.layout.offsetZ??0,this.studio.direction??DEFAULT_DIRECTION));
      this.director.transitionEndsAt(this.now + this.camera.durationMs);
      this.seq++;
    }
  }
  control(command: { type: 'mode'; mode: DirectorMode } | { type: 'shot'; shot: Shot } | { type: 'release'; userId: string } | { type: 'new-session' } | { type:'moderators';userIds:string[] } | {type:'seat-move';userId:string;slotIndex:number}, expectedRevision: number, now: number): number {
    if (expectedRevision !== this.revision) throw new Error('REVISION_CONFLICT');
    this.advance(now);
    if (command.type === 'mode') {this.pendingManual=null;this.director.setMode(command.mode);}
    else if (command.type === 'shot') {
      if (command.shot.userIds.some(id => this.participants.get(id)?.presence !== 'present' || !this.byUser().has(id))) throw new Error('TARGET_NOT_PRESENT');
      if (command.shot.kind === 'TWO_SHOT'||command.shot.kind==='SPLIT') throw new Error('MANUAL_PAIR_NOT_AVAILABLE');
      if(this.now<this.layoutHoldUntil){
        // Keep the operator's latest request instead of silently losing it to the safety wide.
        this.pendingManual=structuredClone(command.shot);if(this.director.mode!=='HOLD')this.director.setMode('MANUAL');
      }else{
        this.pendingManual=null;const decision=this.director.manual(command.shot,this.now,this.studio.direction?.manualReturnSeconds??10);
        if(decision.changed)this.camera=this.protect(planCamera(this.camera,decision.shot,decision.reason,this.byUser(),this.allocator.snapshot().capacity,this.layout.straightLength,this.now,this.avatarExtents(),this.layout.offsetZ??0,this.studio.direction??DEFAULT_DIRECTION));
      }
    } else if(command.type==='seat-move'){
      if(!this.channel)throw new Error('NO_CHANNEL');
      this.allocator.move(command.userId,command.slotIndex);this.allocate();
      const auto=this.director.mode!=='HOLD';this.pendingManual=null;this.director.reset();this.director.setMode(auto?'AUTO':'HOLD');this.layoutMotion=undefined;
      this.layoutHoldUntil=this.now+1000;this.layoutHoldReason='SEAT_MOVED';this.forceWide('SEAT_MOVED');
    } else if(command.type==='moderators'){
      if(!this.channel)throw new Error('NO_CHANNEL');
      this.allocator.setModerators(command.userIds);this.allocate();
    } else if (command.type === 'release') {
      if (this.connection !== 'ready' || this.channel?.channelId !== this.allocator.snapshot().channelId || this.participants.get(command.userId)?.presence === 'stale') throw new Error('MEMBERSHIP_UNCONFIRMED');
      this.allocator.release(command.userId, this.presentIds()); this.allocate();
    }
    else {
      if (!this.channel) throw new Error('NO_CHANNEL');
      const previousHosts=(this.allocator.snapshot().moderatorIds??[]).filter(id=>this.presentIds().includes(id));
      this.allocator = new SeatAllocator(newSession(this.channel.channelId, this.options.sessionId?.() ?? crypto.randomUUID()));
      this.allocators.set(this.channel.channelId, this.allocator);
      this.allocator.updatePresent(this.presentIds(),this.options.utcNow?.()??new Date().toISOString());
      if(previousHosts.length)this.allocator.setModerators(previousHosts);
      this.layout = makeLayout(TABLE.minSeats); this.allocate();
      this.pendingManual=null; this.director.reset(); this.director.setMode('AUTO'); this.layoutHoldUntil = this.now + 1700;this.layoutHoldReason='NEW_SESSION'; this.forceWide('NEW_SESSION');
    }
    this.revision++; this.seq++; this.tick(this.now);
    return this.revision;
  }
  observeEvents(observer:(event:ProviderEvent,processingMs:number)=>void):()=>void{this.observers.add(observer);return ()=>this.observers.delete(observer);}
  rewindReplay(sessions:SeatSession[]):void{
    if(this.options.source!=='replay')throw new Error('REPLAY_ONLY');
    const observers=this.observers;
    Object.assign(this,new AppEngine({...this.options,sessions,serverEpoch:crypto.randomUUID()}));
    this.observers=observers;
  }
  sessions(): SeatSession[] { return [...this.allocators.values()].map(a => a.snapshot()); }
  snapshot(now = this.now): AppSnapshot {
    if (!Number.isFinite(now)) throw new Error('INVALID_TIME');
    return structuredClone({
      protocolVersion: 1, serverEpoch: this.options.serverEpoch, seq: this.seq, revision: this.revision, serverNowMs: Math.max(this.now, now),
      speech:this.presentIds().map(userId=>{const s=this.tracker.stats(userId,this.now);return {userId,activeMs:s.activeMs,ratio:s.ratio,qualified:s.qualified,speechWindowMs:s.windowMs,speechMs10s:this.tracker.intervals(userId,this.now,10000).reduce((n,i)=>n+i.end-i.start,0)};}),
      studio:this.studio, avatarProfiles:[...this.profiles.values()],
      connection: this.connection, errorCode: this.error, channel: this.channel, participants: [...this.participants.values()],
      session: this.allocator.snapshot(), straightLength: this.layout.straightLength, deskOffsetZ:this.layout.offsetZ??0, seats: this.layout.seats, layoutMotion: this.layoutMotion,
      autoResumeAtMs:this.director.autoResumeAtMs, mode: this.director.mode, decision: this.decision, camera: this.camera, source: this.options.source,
    });
  }
}
