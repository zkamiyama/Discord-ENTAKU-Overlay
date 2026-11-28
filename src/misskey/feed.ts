import {emptyMisskeyState,MISSKEY_CARD_LIMIT,MISSKEY_QUEUE_LIMIT,type MisskeyCard,type MisskeyRejectReason,type MisskeySettings,type MisskeyState,type MisskeyStatus} from '../contracts/misskey.ts';
import {MISSKEY_MAX_AGE_MS,moderateMisskeyNote,validMisskeyId,type MisskeyCandidate} from './moderation.ts';
import {validateMisskeySettings} from './settings.ts';

const DEDUPE_TTL=600_000,DEDUPE_LIMIT=2048,USER_COOLDOWN=10_000,USER_LIMIT=4096;
const PUBLISH_INTERVAL=250,PROMOTION_INTERVAL=500,INGRESS_BURST=40;
interface QueuedNote {note:MisskeyCandidate;createdAtMs:number}

/** One bounded owner for moderation and display lifetime. No raw note bodies,
 * network objects, timers, or external images survive ingestion. */
export class MisskeyFeed {
  private configuration:MisskeySettings;
  private state:MisskeyState=emptyMisskeyState();
  private queue:QueuedNote[]=[];
  private readonly seenIds=new Map<string,number>();
  private readonly seenContents=new Map<string,number>();
  private readonly users=new Map<string,number>();
  private readonly listeners=new Set<(state:MisskeyState)=>void>();
  private stopped=false;
  private dirty=false;
  private lastPublished=-Infinity;
  private lastPromoted=-Infinity;
  private lastPruned=-Infinity;
  private lastTime=0;
  private ingressTokens=INGRESS_BURST;
  private ingressAt=0;
  private nextSlot=0;
  private resumeAfter=0;

  constructor(settings:MisskeySettings,private readonly now:()=>number=Date.now){
    this.configuration=validateMisskeySettings(settings);
    this.applyScope();this.state.status=settings.enabled?'connecting':'disabled';
  }
  get settings():MisskeySettings{return structuredClone(this.configuration);}
  get trackedNoteIds():readonly string[]{return [...this.state.cards.map(card=>card.id),...this.queue.map(item=>item.note.id)];}
  snapshot():MisskeyState{return structuredClone(this.state);}
  observe(listener:(state:MisskeyState)=>void):()=>void {
    if(this.stopped)return ()=>{};
    this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};
  }
  private time():number {
    const value=this.now();
    if(Number.isFinite(value))this.lastTime=Math.max(this.lastTime,Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(value))));
    return this.lastTime;
  }
  private applyScope():void {
    this.state.instanceUrl=this.configuration.instanceUrl;this.state.hashtag=this.configuration.hashtag;
    this.state.localOnly=this.configuration.localOnly;this.state.includeHome=this.configuration.includeHome;
  }
  private changed(force=false):void {
    this.dirty=true;this.state.queued=this.queue.length;
    const now=this.time();
    if(force||now-this.lastPublished>=PUBLISH_INTERVAL)this.publish(now);
  }
  private publish(now:number):void {
    if(this.stopped||!this.dirty)return;
    this.state.revision=Math.min(Number.MAX_SAFE_INTEGER,this.state.revision+1);
    this.dirty=false;this.lastPublished=now;
    for(const listener of this.listeners)try{listener(this.snapshot());}catch{/* An observer cannot interrupt ingestion. */}
  }
  private count(reason:MisskeyRejectReason):false {
    this.state.rejected[reason]=Math.min(Number.MAX_SAFE_INTEGER,(this.state.rejected[reason]??0)+1);
    this.changed();return false;
  }
  private remember(cache:Map<string,number>,key:string,now:number,limit:number):void {
    if(cache.has(key))return;
    cache.set(key,now);if(cache.size>limit)cache.delete(cache.keys().next().value!);
  }
  private prune(cache:Map<string,number>,before:number):void {
    for(const [key,time] of cache){if(time>before)break;cache.delete(key);}
  }
  private maintain(now:number):void {
    const live=this.state.cards.filter(card=>card.expiresAt>now);
    if(live.length!==this.state.cards.length){this.state.cards=live;this.dirty=true;}
    const queued=this.queue.filter(item=>{
      if(item.createdAtMs>=now-MISSKEY_MAX_AGE_MS)return true;
      this.state.rejected['too-old']=Math.min(Number.MAX_SAFE_INTEGER,(this.state.rejected['too-old']??0)+1);return false;
    });
    if(queued.length!==this.queue.length){this.queue=queued;this.dirty=true;}
    if(now-this.lastPruned>=1000){
      this.prune(this.seenIds,now-DEDUPE_TTL);this.prune(this.seenContents,now-DEDUPE_TTL);this.prune(this.users,now-USER_COOLDOWN);
      this.lastPruned=now;
    }
    this.state.queued=this.queue.length;
  }
  private promote(now:number):void {
    if(!this.configuration.enabled||this.state.paused||this.state.cards.length>=this.configuration.maxCards||
      !this.queue.length||now-this.lastPromoted<PROMOTION_INTERVAL)return;
    const occupied=new Set(this.state.cards.map(card=>card.slot));
    let slot=this.nextSlot;
    for(let i=0;i<MISSKEY_CARD_LIMIT;i++){
      const candidate=(this.nextSlot+i)%MISSKEY_CARD_LIMIT;
      if(!occupied.has(candidate)){slot=candidate;break;}
    }
    const next=this.queue.shift()!;
    const card:MisskeyCard={...next.note,shownAt:now,expiresAt:now+this.configuration.lifetimeMs,slot};
    this.state.cards.push(card);this.nextSlot=(slot+1)%MISSKEY_CARD_LIMIT;this.lastPromoted=now;this.dirty=true;
    this.state.queued=this.queue.length;
  }
  configure(settings:MisskeySettings):void {
    if(this.stopped)return;
    const clean=validateMisskeySettings(settings),previous=this.configuration,wasPaused=this.state.paused;
    if(JSON.stringify(clean)===JSON.stringify(previous))return;
    const newInstance=clean.instanceUrl!==previous.instanceUrl;
    const newScope=newInstance||clean.hashtag!==previous.hashtag;
    this.configuration=clean;this.queue=[];this.state.cards=[];
    if(newScope){this.seenIds.clear();this.seenContents.clear();this.users.clear();this.resumeAfter=0;}
    if(newScope){
      const revision=this.state.revision;
      this.state={...emptyMisskeyState(),revision};
    }
    this.applyScope();this.state.paused=clean.enabled&&!newScope?wasPaused:false;
    if(!clean.enabled){this.state.status='disabled';this.state.errorCode=null;this.state.retryAt=null;}
    else if(newScope||!previous.enabled){this.state.status='connecting';this.state.errorCode=null;this.state.retryAt=null;}
    this.lastPromoted=-Infinity;this.nextSlot=0;this.changed(true);
  }
  ingest(raw:unknown,source:'live'|'recovery'='live'):boolean {
    if(this.stopped||!this.configuration.enabled||this.state.paused)return false;
    const now=this.time();this.maintain(now);
    this.state.received=Math.min(Number.MAX_SAFE_INTEGER,this.state.received+1);
    if(source==='live')this.state.lastEventAt=now;
    const rawId=raw&&typeof raw==='object'&&!Array.isArray(raw)?(raw as Record<string,unknown>).id:undefined;
    if(validMisskeyId(rawId)){
      const prior=this.seenIds.get(rawId);
      if(prior!==undefined&&now-prior<DEDUPE_TTL)return this.count('duplicate');
      this.seenIds.delete(rawId);
    }
    // Recovery is already limited to three HTTP pages of at most 100 notes by
    // the transport. Applying the live burst budget to a complete page would
    // skip its tail and still advance the recovery cursor past those notes.
    if(source==='live'){
      this.ingressTokens=Math.min(INGRESS_BURST,this.ingressTokens+Math.max(0,now-this.ingressAt)*INGRESS_BURST/1000);this.ingressAt=now;
      if(this.ingressTokens<1)return this.count('rate-limit');
      this.ingressTokens--;
    }
    const result=moderateMisskeyNote(raw,this.configuration,now);
    if(!result.ok)return this.count(result.reason);
    const {note,fingerprint,createdAtMs}=result;
    if(createdAtMs<this.resumeAfter)return this.count('too-old');
    const duplicate=this.seenContents.get(fingerprint);
    if(duplicate!==undefined&&now-duplicate<DEDUPE_TTL)return this.count('duplicate');
    const userCount=this.state.cards.filter(card=>card.userId===note.userId).length+this.queue.filter(item=>item.note.userId===note.userId).length;
    if(userCount>=this.configuration.maxPerUser)return this.count('user-limit');
    const previous=this.users.get(note.userId);
    if(previous!==undefined&&now-previous<USER_COOLDOWN)return this.count('rate-limit');
    if(this.queue.length>=MISSKEY_QUEUE_LIMIT)return this.count('queue-full');
    // Only admitted notes and explicit removal tombstones enter the ID cache.
    // A settings change may legitimately admit a formerly rejected public/home
    // or remote note; rejected IDs must therefore remain eligible for review.
    this.remember(this.seenIds,note.id,now,DEDUPE_LIMIT);
    this.seenContents.delete(fingerprint);this.remember(this.seenContents,fingerprint,now,DEDUPE_LIMIT);
    this.users.delete(note.userId);this.remember(this.users,note.userId,now,USER_LIMIT);
    this.queue.push({note,createdAtMs});this.state.accepted=Math.min(Number.MAX_SAFE_INTEGER,this.state.accepted+1);
    this.promote(now);this.changed();return true;
  }
  /** An edit notification does not prove the new visibility, sensitivity or
   * author policy. Remove immediately and keep a tombstone for recovery races. */
  update(id:string,_change:{text?:unknown;cw?:unknown}):void {this.remove(id);}
  remove(id:string):void {
    if(this.stopped||!validMisskeyId(id))return;
    this.remember(this.seenIds,id,this.time(),DEDUPE_LIMIT);
    const cards=this.state.cards.filter(card=>card.id!==id),queue=this.queue.filter(item=>item.note.id!==id);
    if(cards.length===this.state.cards.length&&queue.length===this.queue.length)return;
    this.state.cards=cards;this.queue=queue;this.changed(true);
  }
  /** Keep deduplication history: reconnect recovery must not resurrect cards
   * which an operator cleared or which disappeared during a connection gap. */
  clear():void {
    if(this.stopped||!this.state.cards.length&&!this.queue.length)return;
    this.state.cards=[];this.queue=[];this.changed(true);
  }
  setPaused(paused:boolean):void {
    if(this.stopped||this.state.paused===paused)return;
    // An HTTP recovery begun before the pause may finish after resuming. Its
    // earlier notes must not reappear when the operator asked for new arrivals.
    if(!paused)this.resumeAfter=this.time();
    this.state.paused=paused;this.state.cards=[];this.queue=[];this.changed(true);
  }
  setConnection(status:MisskeyStatus,errorCode:string|null=null,retryAt:number|null=null):void {
    if(this.stopped)return;
    const next=this.configuration.enabled?status:'disabled';
    const error=errorCode&&/^[A-Z0-9_]{1,96}$/.test(errorCode)?errorCode:null;
    const retry=retryAt!==null&&Number.isSafeInteger(retryAt)&&retryAt>=0?retryAt:null;
    if(next===this.state.status&&error===this.state.errorCode&&retry===this.state.retryAt)return;
    if(next==='reconnecting'&&this.state.status!=='reconnecting')this.state.reconnects=Math.min(Number.MAX_SAFE_INTEGER,this.state.reconnects+1);
    this.state.status=next;this.state.errorCode=error;this.state.retryAt=retry;this.changed(true);
  }
  setRecoveryTruncated(value:boolean):void {
    if(this.stopped||this.state.recoveryTruncated===value)return;
    this.state.recoveryTruncated=value;this.changed();
  }
  tick():void {
    if(this.stopped)return;
    const now=this.time();this.maintain(now);this.promote(now);
    if(this.dirty&&now-this.lastPublished>=PUBLISH_INTERVAL)this.publish(now);
  }
  dispose():void {
    if(this.stopped)return;
    this.stopped=true;this.queue=[];this.state.cards=[];this.state.queued=0;this.state.status='disabled';
    this.listeners.clear();this.seenIds.clear();this.seenContents.clear();this.users.clear();
  }
}
