import { validateProfile, avatarBounds, type AvatarProfile } from '../assets/avatar-profile.ts';
import type { AppSnapshot, CameraPlan, Channel, ConnectionStatus, Decision, DirectorMode, Participant, ProviderEvent, SeatSession, SeatTransform, Shot } from '../contracts/domain.ts';
import { TABLE } from './defaults.ts';
import { makeLayout } from '../geometry/capsule.ts';
import { newSession, SeatAllocator } from './seat-allocator.ts';
import { SpeakerTracker } from './speaker-tracker.ts';
import { ShotDirector } from './shot-director.ts';
import { pairPose, planCamera, widePose, type AvatarExtent } from './camera-planner.ts';

export interface EngineOptions {
  source: AppSnapshot['source'];
  serverEpoch: string;
  sessions?: SeatSession[];
  avatarProfiles?: AvatarProfile[];
  utcNow?: () => string;
  sessionId?: () => string;
}
export class AppEngine {
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
          this.pendingManual=null; this.director.reset(); this.clearSpeech(false); this.participants.clear(); this.membershipDue = null;
          if (nextId) {
            let allocator = this.allocators.get(nextId);
            if (!allocator) {
              allocator = new SeatAllocator(newSession(nextId, this.options.sessionId?.() ?? crypto.randomUUID()));
              this.allocators.set(nextId, allocator);
            }
            this.allocator = allocator;
            this.layout = makeLayout(allocator.snapshot().capacity);
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
    const oldLayout = this.layout;
    const result = this.allocator.updatePresent(this.presentIds(), this.options.utcNow?.() ?? new Date().toISOString());
    if (result.grew) {
      this.layout = makeLayout(this.allocator.snapshot().capacity);
      this.layoutMotion = { fromSeats: oldLayout.seats, fromStraightLength: oldLayout.straightLength, startMs: this.now, durationMs: TABLE.growthDurationMs };
      this.layoutHoldUntil = this.now + TABLE.growthDurationMs + 500;this.layoutHoldReason='LAYOUT_GROWTH';
      this.forceWide('LAYOUT_GROWTH');
    }
    this.membershipDue = null;
  }
  private byUser(): Map<string, SeatTransform> {
    return new Map(this.allocator.snapshot().reservations.map(r => {
      const seat=this.layout.seats[r.slotIndex]!,profile=this.profiles.get(r.userId);
      if(!profile)return [r.userId,seat];
      const yaw=seat.baseYawRad;
      return [r.userId,{...seat,faceAnchor:[seat.faceAnchor[0]+Math.cos(yaw)*profile.offsetX,seat.faceAnchor[1]+profile.offsetY,seat.faceAnchor[2]-Math.sin(yaw)*profile.offsetX] as const}];
    }));
  }
  private avatarExtents(): Map<string,AvatarExtent> {
    return new Map([...this.profiles].map(([id,p])=>{const b=avatarBounds(p);return [id,{halfWidth:Math.max(-b.left,b.right)+Math.abs(p.offsetX),topY:1.25+p.offsetY+b.top,bottomY:Math.max(0,1.25+p.offsetY+b.bottom)}];}));
  }
  setAvatarProfiles(profiles: readonly AvatarProfile[], expectedRevision: number, now: number): void {
    if(expectedRevision!==this.revision)throw new Error('REVISION_CONFLICT');
    const clean=profiles.map(validateProfile);
    if(new Set(clean.map(p=>p.userId)).size!==clean.length)throw new Error('INVALID_AVATAR_PROFILE');
    this.advance(now);this.profiles=new Map(clean.map(p=>[p.userId,p]));
    this.revision++;this.seq++;this.pendingManual=null;this.director.reset();this.layoutHoldUntil=this.now+500;
    this.layoutHoldReason='AVATAR_CHANGED';this.forceWide('AVATAR_CHANGED');this.tick(this.now);
  }
  private forceWide(reason: string): void {
    this.camera = planCamera(this.camera, { kind: 'WIDE', userIds: [] }, reason, this.byUser(), this.allocator.snapshot().capacity, this.layout.straightLength, this.now,this.avatarExtents());
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
        const requested=this.director.manual(shot,this.now);
        if(requested.changed)this.camera=planCamera(this.camera,shot,requested.reason,byUser,this.allocator.snapshot().capacity,this.layout.straightLength,this.now,this.avatarExtents());
        this.seq++;
      }
    }
    const extents=this.avatarExtents();
    this.decision = this.director.update(this.now, this.tracker, {
      presentIds: present, sourceReady: this.connection === 'ready', layoutMoving: this.now < this.layoutHoldUntil, layoutReason:this.layoutHoldReason,
      canPair: (a, b) => !!byUser.get(a) && !!byUser.get(b) && pairPose(byUser.get(a)!, byUser.get(b)!,[a,b].flatMap(id=>extents.has(id)?[extents.get(id)!]:[])) !== null,
    });
    if (this.decision.changed) {
      this.camera = planCamera(this.camera, this.decision.shot, this.decision.reason, byUser, this.allocator.snapshot().capacity, this.layout.straightLength, this.now,this.avatarExtents());
      this.director.transitionEndsAt(this.now + this.camera.durationMs);
      this.seq++;
    }
  }
  control(command: { type: 'mode'; mode: DirectorMode } | { type: 'shot'; shot: Shot } | { type: 'release'; userId: string } | { type: 'new-session' }, expectedRevision: number, now: number): number {
    if (expectedRevision !== this.revision) throw new Error('REVISION_CONFLICT');
    this.advance(now);
    if (command.type === 'mode') {this.pendingManual=null;this.director.setMode(command.mode);}
    else if (command.type === 'shot') {
      if (command.shot.userIds.some(id => this.participants.get(id)?.presence !== 'present' || !this.byUser().has(id))) throw new Error('TARGET_NOT_PRESENT');
      if (command.shot.kind === 'TWO_SHOT') throw new Error('MANUAL_PAIR_NOT_AVAILABLE');
      if(this.now<this.layoutHoldUntil){
        // Keep the operator's latest request instead of silently losing it to the safety wide.
        this.pendingManual=structuredClone(command.shot);this.director.setMode('MANUAL');
      }else{
        this.pendingManual=null;const decision=this.director.manual(command.shot,this.now);
        if(decision.changed)this.camera=planCamera(this.camera,decision.shot,decision.reason,this.byUser(),this.allocator.snapshot().capacity,this.layout.straightLength,this.now,this.avatarExtents());
      }
    } else if (command.type === 'release') {
      if (this.connection !== 'ready' || this.channel?.channelId !== this.allocator.snapshot().channelId || this.participants.get(command.userId)?.presence === 'stale') throw new Error('MEMBERSHIP_UNCONFIRMED');
      this.allocator.release(command.userId, this.presentIds()); this.allocate();
    }
    else {
      if (!this.channel) throw new Error('NO_CHANNEL');
      this.allocator = new SeatAllocator(newSession(this.channel.channelId, this.options.sessionId?.() ?? crypto.randomUUID()));
      this.allocators.set(this.channel.channelId, this.allocator);
      this.layout = makeLayout(TABLE.minSeats); this.allocate();
      this.pendingManual=null; this.director.reset(); this.director.setMode('AUTO'); this.layoutHoldUntil = this.now + 1700;this.layoutHoldReason='NEW_SESSION'; this.forceWide('NEW_SESSION');
    }
    this.revision++; this.seq++; this.tick(this.now);
    return this.revision;
  }
  sessions(): SeatSession[] { return [...this.allocators.values()].map(a => a.snapshot()); }
  snapshot(now = this.now): AppSnapshot {
    if (!Number.isFinite(now)) throw new Error('INVALID_TIME');
    return structuredClone({
      protocolVersion: 1, serverEpoch: this.options.serverEpoch, seq: this.seq, revision: this.revision, serverNowMs: Math.max(this.now, now),
      avatarProfiles:[...this.profiles.values()],
      connection: this.connection, errorCode: this.error, channel: this.channel, participants: [...this.participants.values()],
      session: this.allocator.snapshot(), straightLength: this.layout.straightLength, seats: this.layout.seats, layoutMotion: this.layoutMotion,
      mode: this.director.mode, decision: this.decision, camera: this.camera, source: this.options.source,
    });
  }
}
