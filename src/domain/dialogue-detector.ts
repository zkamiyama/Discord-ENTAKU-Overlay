import {SpeakerTracker,type SpeechInterval} from './speaker-tracker.ts';
import {DIRECTOR} from './defaults.ts';
/** Heuristic thresholds, not emotion classification or an ASR model. */
export const DIALOGUE=Object.freeze({windowMs:10000,minSpeechMs:2000,minCoverageMs:5000,pairShare:.85,minorShare:.30,minTurns:3,minOverlapMs:1200,minTurnMs:700,maxReplyGapMs:2000,recentMs:3000,confirmMs:2500,releaseMs:5000,cooldownMs:10000});
export interface DialogueEvidence {
 pair:[string,string]|null;spokenMs:[number,number];pairShare:number;minorShare:number;
 overlapMs:number;coverageMs:number;alternations:number;thirdActive:boolean;
 eligible:boolean;reason:string;
}
function overlap(a:readonly SpeechInterval[],b:readonly SpeechInterval[]):number{
 let i=0,j=0,total=0;
 while(i<a.length&&j<b.length){const x=a[i]!,y=b[j]!;total+=Math.max(0,Math.min(x.end,y.end)-Math.max(x.start,y.start));if(x.end<y.end)i++;else j++;}
 return total;
}
function turns(segments:readonly SpeechInterval[],userId:string):Array<SpeechInterval&{userId:string;speechMs:number}>{
 const result:Array<SpeechInterval&{userId:string;speechMs:number}>=[];
 for(const s of segments){const previous=result.at(-1);if(previous&&s.start-previous.end<=DIRECTOR.gapToleranceMs){previous.end=s.end;previous.speechMs+=s.end-s.start;}else result.push({...s,userId,speechMs:s.end-s.start});}
 return result.filter(t=>t.speechMs>=DIALOGUE.minTurnMs);
}
/** Reuses bounded 10-second START/STOP intervals. O(N log N + E log E), O(E) memory.
 * Simultaneous speech counts separately per speaker; overlap and coverage use wall time. */
export function detectDialogue(tracker:SpeakerTracker,ids:readonly string[],now:number):DialogueEvidence{
 const order=new Map(ids.map((id,i)=>[id,i]));
 const stats=ids.map(id=>tracker.stats(id,now)).sort((a,b)=>b.windowMs-a.windowMs||order.get(a.userId)!-order.get(b.userId)!);
 const empty:DialogueEvidence={pair:null,spokenMs:[0,0],pairShare:0,minorShare:0,overlapMs:0,coverageMs:0,alternations:0,thirdActive:false,eligible:false,reason:'NEED_TWO_SPEAKERS'};
 if(stats.length<2||!stats[1]!.windowMs)return empty;
 const a=stats[0]!,b=stats[1]!,total=stats.reduce((n,s)=>n+s.windowMs,0),sum=a.windowMs+b.windowMs;
 const x=tracker.intervals(a.userId,now),y=tracker.intervals(b.userId,now),both=overlap(x,y);
 const sequence=[...turns(x,a.userId),...turns(y,b.userId)].sort((u,v)=>u.start-v.start||order.get(u.userId)!-order.get(v.userId)!);
 let alternations=0;
 for(let i=1;i<sequence.length;i++){const previous=sequence[i-1]!,current=sequence[i]!;if(previous.userId!==current.userId&&current.start-previous.end<=DIALOGUE.maxReplyGapMs)alternations++;}
 const thirdActive=stats.slice(2).some(s=>s.qualified);
 // Seating order fixes screen sides; leadership may change without swapping faces.
 const pair=[a.userId,b.userId].sort((u,v)=>order.get(u)!-order.get(v)!) as [string,string];
 const evidence:DialogueEvidence={pair,spokenMs:pair[0]===a.userId?[a.windowMs,b.windowMs]:[b.windowMs,a.windowMs],pairShare:sum/Math.max(1,total),minorShare:Math.min(a.windowMs,b.windowMs)/sum,overlapMs:both,coverageMs:sum-both,alternations,thirdActive,eligible:false,reason:'INSUFFICIENT_SPEECH'};
 if(thirdActive)evidence.reason='THIRD_SPEAKER';
 else if(Math.min(a.windowMs,b.windowMs)<DIALOGUE.minSpeechMs||evidence.coverageMs<DIALOGUE.minCoverageMs)evidence.reason='INSUFFICIENT_SPEECH';
 else if(evidence.pairShare<DIALOGUE.pairShare)evidence.reason='NOT_A_TWO_PERSON_DISCUSSION';
 else if(evidence.minorShare<DIALOGUE.minorShare)evidence.reason='BACKCHANNEL_OR_DOMINANCE';
 else if(Math.max(a.stoppedForMs,b.stoppedForMs)>DIALOGUE.recentMs||(a.state!=='active'&&b.state!=='active'&&Math.min(a.stoppedForMs,b.stoppedForMs)>DIRECTOR.gapToleranceMs))evidence.reason='DISCUSSION_PAUSED';
 else if(alternations<DIALOGUE.minTurns&&both<DIALOGUE.minOverlapMs)evidence.reason='INSUFFICIENT_EXCHANGE';
 else {evidence.eligible=true;evidence.reason=both>=DIALOGUE.minOverlapMs?'SUSTAINED_OVERLAP':'RAPID_ALTERNATION';}
 return evidence;
}
