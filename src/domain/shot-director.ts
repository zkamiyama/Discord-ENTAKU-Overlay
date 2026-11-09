import type { Decision, DirectorMode, Shot } from '../contracts/domain.ts';
import { DIRECTOR as C } from './defaults.ts';
import { SpeakerTracker } from './speaker-tracker.ts';
export interface DirectorContext {
 presentIds:readonly string[];sourceReady:boolean;layoutMoving:boolean;layoutReason?:string;
 canPair:(a:string,b:string)=>boolean;
}
const wide=():Shot=>({kind:'WIDE',userIds:[]});
const same=(a:Shot,b:Shot):boolean=>a.kind===b.kind&&a.userIds.join(',')===b.userIds.join(',');
/** Every conversational change uses one cancellable five-second candidate timer.
 * Safety (source loss/layout growth) and explicit operator shots bypass that timer. */
export class ShotDirector {
 mode:DirectorMode='AUTO';
 autoResumeAtMs:number|null=null;
 private shot:Shot=wide();private holdUntil=-Infinity;
 private pending:{shot:Shot;reason:string;since:number}|null=null;
 private missingSince:number|null=null;
 reset():void {this.shot=wide();this.holdUntil=-Infinity;this.pending=null;this.missingSince=null;this.autoResumeAtMs=null;}
 current():Shot{return structuredClone(this.shot);}
 setMode(mode:DirectorMode):void {this.mode=mode;this.autoResumeAtMs=null;this.pending=null;this.missingSince=null;}
 manual(shot:Shot,now:number,returnSeconds=10):Decision {
  const fixed=this.mode==='HOLD';this.mode=fixed?'HOLD':'MANUAL';
  this.autoResumeAtMs=fixed?null:now+returnSeconds*1000;this.pending=null;
  return this.choose(shot,'MANUAL_OVERRIDE',now);
 }
 transitionEndsAt(now:number):void {this.holdUntil=now+C.minShotMs;}
 update(now:number,tracker:SpeakerTracker,context:DirectorContext):Decision {
  if(this.mode==='MANUAL'&&this.autoResumeAtMs!==null&&now>=this.autoResumeAtMs){
   this.mode='AUTO';this.autoResumeAtMs=null;this.pending=null;
  }
  if(!context.sourceReady||context.layoutMoving){
   this.pending=null;
   return this.choose(wide(),!context.sourceReady?'SOURCE_LOST':context.layoutReason??'LAYOUT_GROWTH',now);
  }
  const ids=context.presentIds;
  if(this.shot.userIds.some(id=>!ids.includes(id))){
   this.missingSince??=now;
   if(now-this.missingSince>=C.changeGraceMs){this.pending=null;return this.choose(wide(),'TARGET_LEFT',now);}
   return this.keep('TARGET_LEFT_GRACE',now,this.missingSince+C.changeGraceMs);
  }
  this.missingSince=null;
  if(this.mode!=='AUTO')return this.keep('MANUAL_OVERRIDE',now);
  const stats=ids.map(id=>tracker.stats(id,now)),active=stats.filter(s=>s.state==='active');
  const turns=tracker.episodes(now,4000).filter(e=>ids.includes(e.userId));
  const collapsed=turns.filter((e,i)=>i===0||turns[i-1]!.userId!==e.userId);
  const rapid=new Set(collapsed.map(e=>e.userId)).size>=3&&collapsed.length-1>=5;
  if(active.length>=3||rapid)return this.propose(wide(),active.length>=3?'CROWD_OVERLAP':'CROWD_TURN_RATE',now);
  if(!active.length)return this.propose(wide(),'SILENCE',now);
  const qualified=stats.filter(s=>s.qualified).sort((a,b)=>b.recentMs-a.recentMs||a.episodeStart-b.episodeStart||ids.indexOf(a.userId)-ids.indexOf(b.userId));
  const a=qualified[0],b=qualified[1];
  const pair=(x:string,y:string):Shot=>({kind:'TWO_SHOT',userIds:[x,y].sort((x,y)=>ids.indexOf(x)-ids.indexOf(y)) as [string,string]});
  if(a&&b&&context.canPair(a.userId,b.userId))return this.propose(pair(a.userId,b.userId),'NEARBY_DIALOGUE',now);
  const dialogue=tracker.episodes(now,C.turnWindowMs).filter(e=>ids.includes(e.userId));
  const major=dialogue.filter((e,i)=>i===0||dialogue[i-1]!.userId!==e.userId).slice(-3);
  if(major.length===3&&major[0]!.userId===major[2]!.userId&&major[0]!.userId!==major[1]!.userId&&active.some(s=>major.some(e=>e.userId===s.userId))&&context.canPair(major[0]!.userId,major[1]!.userId))return this.propose(pair(major[0]!.userId,major[1]!.userId),'NEARBY_DIALOGUE',now);
  if(a){
   if(this.shot.kind==='SINGLE'&&this.shot.userIds[0]!==a.userId){
    const incumbent=stats.find(s=>s.userId===this.shot.userIds[0]);
    if(incumbent&&(incumbent.state==='active'?a.recentMs<incumbent.recentMs+800:incumbent.stoppedForMs<C.incumbentGraceMs)){
     this.pending=null;return this.keep('INCUMBENT_PROTECTED',now);
    }
   }
   return this.propose({kind:'SINGLE',userIds:[a.userId]},'SPEAKER_QUALIFIED',now);
  }
  this.pending=null;return this.keep('BACKCHANNEL_IGNORED',now);
 }
 private propose(shot:Shot,reason:string,now:number):Decision {
  if(same(shot,this.shot)){this.pending=null;return this.keep(reason,now);}
  if(!this.pending||!same(this.pending.shot,shot))this.pending={shot:structuredClone(shot),reason,since:now};
  const at=Math.max(this.pending.since+C.changeGraceMs,this.holdUntil);
  if(now<at)return {...this.keep('AUTO_CHANGE_GRACE',now,at),pendingShot:structuredClone(this.pending.shot),switchAtMs:at};
  this.pending=null;return this.choose(shot,reason,now);
 }
 private keep(reason:string,now:number,until=this.holdUntil):Decision{return {shot:this.current(),reason,changed:false,holdRemainingMs:Math.max(0,until-now)};}
 private choose(shot:Shot,reason:string,now:number):Decision {
  if(same(this.shot,shot))return this.keep(reason,now);
  this.shot=structuredClone(shot);this.holdUntil=now+C.minShotMs;
  return {shot:this.current(),reason,changed:true,holdRemainingMs:C.minShotMs};
 }
}
