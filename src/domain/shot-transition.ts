import type {Shot} from '../contracts/domain.ts';
export type TransitionCause='start'|'end';
export interface PendingTransition {shot:Shot;reason:string;since:number;kind:TransitionCause;at:number}
export type TransitionPhase=
 | {phase:'END_CONFIRMING'|'START_PENDING'|'END_GRACE';deadline:number}
 | {phase:'STABLE'};
export function sameShot(a:Shot,b:Shot):boolean{return a.kind===b.kind&&a.userIds.join(',')===b.userIds.join(',');}
/** Repeated ticks refresh the deadline but never reset the candidate's onset. */
export function pendingTransition(previous:PendingTransition|null,shot:Shot,reason:string,kind:TransitionCause,at:number,now:number):PendingTransition {
 return {shot:structuredClone(shot),reason,kind,at,since:previous&&previous.kind===kind&&sameShot(previous.shot,shot)?previous.since:now};
}
/** END confirmation and framing grace use absolute times. A camera MOVE may
 * extend the final hold, but must not move the speech-confirmation boundary. */
export function transitionPhase(kind:TransitionCause,readyAt:number,holdUntil:number,endGraceMs:number,now:number):TransitionPhase {
 const confirmAt=kind==='end'?readyAt-endGraceMs:-Infinity;
 if(now<confirmAt)return {phase:'END_CONFIRMING',deadline:confirmAt};
 const deadline=Math.max(readyAt,holdUntil);
 return now<deadline?{phase:kind==='start'?'START_PENDING':'END_GRACE',deadline}:{phase:'STABLE'};
}
