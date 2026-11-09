import {DEFAULT_DIRECTION,directionTiming,type DirectionSettings} from '../studio/direction.ts';
import {detectDialogue,DIALOGUE,type DialogueEvidence} from './dialogue-detector.ts';
import type { Decision, DirectorMode, Shot } from '../contracts/domain.ts';
import { DIRECTOR as C } from './defaults.ts';
import { SpeakerTracker, type ConversationStats } from './speaker-tracker.ts';
export interface DirectorContext {
 presentIds:readonly string[];sourceReady:boolean;layoutMoving:boolean;layoutReason?:string;
 canPair:(a:string,b:string)=>boolean;preferPair?:(a:string,b:string)=>boolean;splitEnabled?:boolean;canSplit?:(a:string,b:string)=>boolean;
}
const wide=():Shot=>({kind:'WIDE',userIds:[]});
const same=(a:Shot,b:Shot):boolean=>a.kind===b.kind&&a.userIds.join(',')===b.userIds.join(',');
/** START: configurable actual speech time (default 1.5s), including qualification.
 * STOP: configurable end confirmation and subsequent framing grace.
 * A returning speaker cancels both phases; raw speech totals exclude the silence.
 * Leadership is measured by exact overlap with the configured window, not START order. */
export class ShotDirector {
  clone(): ShotDirector {return Object.assign(new ShotDirector(), structuredClone(this));}
 private timing=directionTiming();
 constructor(settings:DirectionSettings=DEFAULT_DIRECTION){this.configure(settings);}
 configure(settings:DirectionSettings):void{this.timing=directionTiming(settings);}
 mode:DirectorMode='AUTO';autoResumeAtMs:number|null=null;
 private bridge:{ids:string[];missing:Map<string,number>}|null=null;
 private dialogue?:DialogueEvidence;private splitCandidate:{key:string;since:number}|null=null;private splitWeakAt:number|null=null;private splitCooldownUntil=-Infinity;
 private shot:Shot=wide();private holdUntil=-Infinity;
 private pending:{shot:Shot;reason:string;since:number;kind:'start'|'end';at:number}|null=null;
 private missingSince:number|null=null;private autoSince:number|null=null;private leader?:string;private crowdWide=false;private crowdEndedAt:number|null=null;
 reset():void {this.bridge=null;this.dialogue=undefined;this.splitCandidate=null;this.splitWeakAt=null;this.splitCooldownUntil=-Infinity;this.shot=wide();this.holdUntil=-Infinity;this.pending=null;this.missingSince=null;this.autoResumeAtMs=null;this.autoSince=null;this.leader=undefined;this.crowdWide=false;this.crowdEndedAt=null;}
 current():Shot{return structuredClone(this.shot);}
 setMode(mode:DirectorMode):void {this.bridge=null;this.splitCandidate=null;this.splitWeakAt=null;this.mode=mode;this.autoResumeAtMs=null;this.pending=null;this.missingSince=null;this.autoSince=null;}
 manual(shot:Shot,now:number,returnSeconds=10):Decision {
  this.bridge=null;this.splitCandidate=null;this.splitWeakAt=null;
  const fixed=this.mode==='HOLD';this.mode=fixed?'HOLD':'MANUAL';
  this.autoResumeAtMs=fixed?null:now+returnSeconds*1000;this.pending=null;
  return this.choose(shot,'MANUAL_OVERRIDE',now);
 }
 // Do not add another five-second delay on top of speech qualification / camera MOVE.
 transitionEndsAt(now:number):void {this.holdUntil=Math.max(this.holdUntil,now);}
 update(now:number,tracker:SpeakerTracker,context:DirectorContext):Decision {
  if(this.mode==='MANUAL'&&this.autoResumeAtMs!==null&&now>=this.autoResumeAtMs){
   this.mode='AUTO';this.autoResumeAtMs=null;this.pending=null;this.autoSince=now;
  }
  if(!context.sourceReady||context.layoutMoving){
   this.bridge=null;this.pending=null;this.leader=undefined;this.dialogue=undefined;this.splitCandidate=null;this.splitWeakAt=null;
   return this.choose(wide(),!context.sourceReady?'SOURCE_LOST':context.layoutReason??'LAYOUT_GROWTH',now);
  }
  const ids=context.presentIds;
  if(this.shot.userIds.some(id=>!ids.includes(id))){
   this.missingSince??=now;
   if(now-this.missingSince>=this.timing.endGraceMs){this.pending=null;return this.choose(wide(),'TARGET_LEFT',now);}
   return this.keep('TARGET_LEFT_GRACE',now,this.missingSince+this.timing.endGraceMs);
  }
  this.missingSince=null;
  if(this.shot.kind==='SPLIT'&&!context.splitEnabled){this.dialogue=undefined;return this.choose({kind:'SINGLE',userIds:[this.shot.userIds[0]]},'SPLIT_DISABLED',now);}
  if(this.mode!=='AUTO')return this.keep('MANUAL_OVERRIDE',now);
  this.autoSince??=now;
  const stats=ids.map(id=>tracker.conversationStats(id,now)),active=stats.filter(s=>s.state==='active');
  const qualified=active.filter(s=>s.qualified).sort((a,b)=>b.windowMs-a.windowMs||Number(this.shot.userIds.some(id=>id===b.userId))-Number(this.shot.userIds.some(id=>id===a.userId))||ids.indexOf(a.userId)-ids.indexOf(b.userId));
  this.leader=qualified[0]?.userId;
  if(this.crowdWide){
   const stops=stats.filter(s=>s.rawState==='inactive'&&s.activeMs>=this.timing.qualifyMs).map(s=>s.endPendingUntilMs??now-s.stoppedForMs);
   this.crowdEndedAt=stops.length?Math.max(...stops):null;
  }
  const bridge=this.bridgeDecision(now,stats,qualified);if(bridge)return bridge;
  const paused=stats.filter(s=>(this.shot.userIds.some(id=>id===s.userId)||(this.shot.kind==='WIDE'&&this.crowdWide&&s.qualified))&&s.endPendingUntilMs!==undefined);
  const newSpeaker=this.shot.kind!=='WIDE'&&qualified.some(s=>s.rawState==='active'&&!this.shot.userIds.some(id=>id===s.userId)&&s.activeMs>=this.timing.startGraceMs);
  if(paused.length&&!newSpeaker){
   // A hesitation is not an END and must not restart onset qualification.
   this.pending=null;this.splitWeakAt=null;
   const until=Math.max(...paused.map(s=>s.endPendingUntilMs!));
   return {...this.keep('SPEECH_END_CONFIRM',now,until),switchAtMs:until};
  }
  const split=this.splitDecision(now,tracker,context,stats,qualified);if(split)return split;
  if(!active.length){
   const lastStop=Math.max(this.autoSince,...stats.filter(s=>s.state==='inactive').map(s=>now-s.stoppedForMs));
   return this.propose(wide(),'SILENCE',now,'end',lastStop+this.timing.endGraceMs);
  }
  // Brief interjections never establish a new shot. Incumbent pair members may
  // resume immediately without being discarded while re-qualifying their turn.
  if(this.shot.kind==='TWO_SHOT'&&active.length<3){
   const currentIds=this.shot.userIds;
   const inside=active.filter(s=>currentIds.includes(s.userId));
   if(inside.length===2&&inside.some(s=>!s.qualified)){
    this.pending=null;return this.keep('SPEAKER_RESUMED',now);
   }
   if(inside.length===1&&!qualified.some(s=>!currentIds.includes(s.userId))){
    const other=stats.find(s=>currentIds.includes(s.userId)&&s.userId!==inside[0]!.userId);
    if(other?.state==='inactive')return this.propose({kind:'SINGLE',userIds:[inside[0]!.userId]},'SPEECH_ENDED',now,'end',Math.max(now-other.stoppedForMs+this.timing.endGraceMs,now+Math.max(0,this.timing.startGraceMs-inside[0]!.activeMs)));
   }
  }
  if(!qualified.length){this.pending=null;return this.keep('BACKCHANNEL_IGNORED',now);}
  const a=qualified[0]!,b=qualified[1];
  const dominates=!!b&&a.windowMs>=b.windowMs*C.dominanceRatio&&a.windowMs-b.windowMs>=C.dominanceMarginMs;
  const readiness=(speakers:readonly ConversationStats[])=>Math.max(now,...speakers.map(s=>now+Math.max(0,this.timing.startGraceMs-s.activeMs)));
  if(qualified.length>=3&&!dominates){
   if(this.shot.kind==='WIDE'&&readiness(qualified.slice(0,3))<=now)this.crowdWide=true;
   return this.propose(wide(),'CROWD_OVERLAP',now,'start',readiness(qualified.slice(0,3)));
  }
  if(b&&!dominates&&context.canPair(a.userId,b.userId)){
   const pair:Shot={kind:'TWO_SHOT',userIds:[a.userId,b.userId].sort((x,y)=>ids.indexOf(x)-ids.indexOf(y)) as [string,string]};
   const newcomers=[a,b].filter(s=>!this.shot.userIds.some(id=>id===s.userId));
   return this.propose(pair,'BALANCED_DIALOGUE',now,'start',readiness(newcomers.length?newcomers:[a,b]));
  }
  // A close tie must not cause ping-pong between two active speakers.
  if(this.shot.kind==='SINGLE'&&a.userId!==this.shot.userIds[0]){
   const incumbent=qualified.find(s=>s.userId===this.shot.userIds[0]);
   if(incumbent&&a.windowMs-incumbent.windowMs<C.dominanceMarginMs){this.pending=null;return this.keep('LEADER_MARGIN',now);}
  }
  const target:Shot={kind:'SINGLE',userIds:[a.userId]};
  const scoreChange=(this.shot.kind==='TWO_SHOT'&&active.length>=2)||(this.shot.kind==='SINGLE'&&qualified.some(s=>s.userId===this.shot.userIds[0])&&this.shot.userIds[0]!==a.userId);
  // An already established conversation needs stable leadership, not a single
  // score crossing. New speech uses its own elapsed time, never 1s + 2.5s.
  const since=this.pending&&same(this.pending.shot,target)&&this.pending.kind==='start'?this.pending.since:now;
  return this.propose(target,dominates||scoreChange?'DOMINANT_SPEAKER_WINDOW':'SPEAKER_QUALIFIED',now,'start',scoreChange?Math.max(readiness([a]),since+this.timing.startGraceMs):readiness([a]));
 }
 /** A third participant opens the scene before it is reframed. Do not let the
  * windowed leaderboard immediately collapse this establishing wide shot. */
 private bridgeDecision(now:number,stats:ConversationStats[],qualified:ConversationStats[]):Decision|null{
  const bridge=this.bridge;if(!bridge||this.shot.kind!=='WIDE')return null;
  for(const s of qualified)if(s.activeMs>=this.timing.startGraceMs&&!bridge.ids.includes(s.userId))bridge.ids.push(s.userId);
  let active=0;const deadlines:number[]=[],confirmations:number[]=[];
  for(const id of bridge.ids){
   const s=stats.find(s=>s.userId===id);
   if(s?.state==='active'){active++;if(s.endPendingUntilMs!==undefined)confirmations.push(s.endPendingUntilMs);bridge.missing.delete(id);continue;}
   const stopped=s?.state==='inactive'?now-s.stoppedForMs:bridge.missing.get(id)??now;
   bridge.missing.set(id,stopped);const deadline=stopped+this.timing.endGraceMs;
   if(deadline>now)deadlines.push(deadline);
  }
  this.pending=null;
  if(active-confirmations.length>=3)return this.keep('THREE_PERSON_DISCUSSION',now);
  if(confirmations.length){
   const until=Math.max(...confirmations);
   return {...this.keep('THIRD_SPEAKER_END_CONFIRM',now,until),switchAtMs:until};
  }
  if(deadlines.length){
   // When both former speakers stop at different times, wait for the later
   // confirmed END. Counting down only the first would drop the other early.
   const until=Math.max(...deadlines,this.holdUntil);
   return {...this.keep('THIRD_SPEAKER_END_GRACE',now,until),switchAtMs:until};
  }
  // The STOP grace has already been paid. Resume normal leadership immediately,
  // but require a new stable two-person scene before allowing another split.
  this.bridge=null;this.crowdWide=false;this.crowdEndedAt=null;
  this.splitCandidate=null;this.splitCooldownUntil=Math.max(this.splitCooldownUntil,now+DIALOGUE.cooldownMs);
  return null;
 }
 /** Split is a presentation state above the existing conversational director. */
 private splitDecision(now:number,tracker:SpeakerTracker,context:DirectorContext,stats:ConversationStats[],qualified:ConversationStats[]):Decision|null{
  if(!context.splitEnabled){this.dialogue=undefined;this.splitCandidate=null;this.splitWeakAt=null;if(this.shot.kind==='SPLIT')return this.choose(qualified[0]?{kind:'SINGLE',userIds:[qualified[0].userId]}:wide(),'SPLIT_DISABLED',now);return null;}
  const evidence=detectDialogue(tracker,context.presentIds,now);this.dialogue=evidence;
  if(this.shot.kind==='SPLIT'){
   const pair=this.shot.userIds,members=stats.filter(s=>pair.includes(s.userId));
   if(context.preferPair?.(...pair)&&context.canPair(...pair))return this.choose({kind:'TWO_SHOT',userIds:pair},'ADJACENT_SHARED_CAMERA',now);
   const outsiders=qualified.filter(s=>s.rawState==='active'&&!pair.includes(s.userId));
   if(outsiders.length){
    // One established newcomer is sufficient. A fourth person's later START
    // must not keep postponing the third person's deadline.
    const readyAt=Math.min(...outsiders.map(s=>now+Math.max(0,this.timing.startGraceMs-s.activeMs)));
    const decision=this.propose(wide(),'SPLIT_THIRD_SPEAKER',now,'start',readyAt);
    if(decision.changed)this.bridge={ids:[...pair,...outsiders.filter(s=>s.activeMs>=this.timing.startGraceMs).map(s=>s.userId)],missing:new Map()};
    return decision;
   }
   const active=members.filter(s=>s.state==='active');
   if(active.length<2){
    // Renewed speech cancels this exact STOP-based deadline on the next tick.
    const stop=Math.max(...members.filter(s=>s.state==='inactive').map(s=>now-s.stoppedForMs));
    const target:Shot=active[0]?{kind:'SINGLE',userIds:[active[0].userId]}:wide();
    return this.propose(target,active.length?'SPLIT_SPEECH_ENDED':'SILENCE',now,'end',stop+this.timing.endGraceMs);
   }
   if(active.some(s=>!s.qualified)){this.pending=null;this.splitWeakAt=null;return this.keep('SPEAKER_RESUMED',now);}
   if(evidence.eligible&&evidence.pair?.every(id=>pair.includes(id))){this.splitWeakAt=null;this.pending=null;return this.keep('SPLIT_ACTIVE_DISCUSSION',now);}
   this.splitWeakAt??=now;
   if(now<Math.max(this.splitWeakAt+this.timing.endGraceMs,this.holdUntil))return this.keep('SPLIT_RELEASE_GRACE',now,Math.max(this.splitWeakAt+this.timing.endGraceMs,this.holdUntil));
   this.splitWeakAt=null;this.pending=null;
   const a=qualified[0],b=qualified[1];
   const balanced=a&&b&&!(a.windowMs>=b.windowMs*C.dominanceRatio&&a.windowMs-b.windowMs>=C.dominanceMarginMs);
   return this.choose(balanced&&context.canPair(a.userId,b.userId)?{kind:'TWO_SHOT',userIds:pair}:a?{kind:'SINGLE',userIds:[a.userId]}:wide(),'SPLIT_DISCUSSION_SETTLED',now);
  }
  if(evidence.eligible&&evidence.pair&&context.preferPair?.(...evidence.pair)){
   this.splitCandidate=null;this.dialogue={...evidence,eligible:false,reason:'ADJACENT_SHARED_CAMERA'};
   // A spatially adjacent conversation stays in one continuous frame, even
   // during rapid alternation where only one raw START is active at a time.
   if(context.canPair(...evidence.pair)){
    const target:Shot={kind:'TWO_SHOT',userIds:evidence.pair};
    const since=this.pending&&same(this.pending.shot,target)?this.pending.since:now;
    return this.propose(target,'ADJACENT_SHARED_CAMERA',now,'start',since+this.timing.startGraceMs);
   }
   return null;
  }
  if(!evidence.eligible||!evidence.pair||now<this.splitCooldownUntil){this.splitCandidate=null;return null;}
  if(!context.canSplit?.(...evidence.pair)){this.splitCandidate=null;this.dialogue={...evidence,eligible:false,reason:'SPLIT_NO_SAFE_FRAMING'};return null;}
  const key=evidence.pair.join(',');if(this.splitCandidate?.key!==key)this.splitCandidate={key,since:now};
  return this.propose({kind:'SPLIT',userIds:evidence.pair},'SPLIT_'+evidence.reason,now,'start',this.splitCandidate.since+this.timing.startGraceMs);
 }
 private propose(shot:Shot,reason:string,now:number,kind:'start'|'end',readyAt:number):Decision {
  if(same(shot,this.shot)){this.pending=null;return this.keep(reason,now);}
  if(this.shot.kind==='WIDE'&&this.crowdWide&&shot.kind!=='WIDE'){
   // A crowd ending is an END transition, not a new speaker's START.
   const stopped=this.crowdEndedAt;
   if(stopped!==null){kind='end';readyAt=Math.max(readyAt,stopped+this.timing.endGraceMs);}
  }
  if(!this.pending||!same(this.pending.shot,shot)||this.pending.kind!==kind)this.pending={shot:structuredClone(shot),reason,since:now,kind,at:readyAt};
  this.pending.at=readyAt;this.pending.reason=reason;
  const confirmAt=kind==='end'?readyAt-this.timing.endGraceMs:-Infinity;
  if(now<confirmAt)return {...this.keep('SPEECH_END_CONFIRM',now,confirmAt),switchAtMs:confirmAt};
  const at=Math.max(readyAt,this.holdUntil);
  if(now<at)return {...this.keep(kind==='start'?'SPEECH_START_GRACE':'SPEECH_END_GRACE',now,at),pendingShot:structuredClone(shot),switchAtMs:at};
  this.pending=null;return this.choose(shot,reason,now);
 }
 private keep(reason:string,now:number,until=this.holdUntil):Decision{return {shot:this.current(),reason,changed:false,holdRemainingMs:Math.max(0,until-now),leaderUserId:this.leader,...(this.dialogue?{dialogue:this.dialogue}:{})};}
 private choose(shot:Shot,reason:string,now:number):Decision {
  if(same(this.shot,shot))return this.keep(reason,now);
  if(this.shot.kind==='SPLIT'&&shot.kind!=='SPLIT'){this.splitCooldownUntil=now+DIALOGUE.cooldownMs;this.splitCandidate=null;this.splitWeakAt=null;}
  this.bridge=null;this.shot=structuredClone(shot);this.crowdWide=shot.kind==='WIDE'&&(reason==='CROWD_OVERLAP'||reason==='SPLIT_THIRD_SPEAKER');this.crowdEndedAt=null;this.holdUntil=now+this.timing.minShotMs;
  return {shot:this.current(),reason,changed:true,holdRemainingMs:this.timing.minShotMs,leaderUserId:this.leader,...(this.dialogue?{dialogue:this.dialogue}:{})};
 }
}
