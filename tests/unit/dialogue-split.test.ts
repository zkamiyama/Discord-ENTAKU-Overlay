import {expect,test} from 'bun:test';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
import {detectDialogue} from '../../src/domain/dialogue-detector.ts';
import {ShotDirector,type DirectorContext} from '../../src/domain/shot-director.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';
import {splitPanelCameras,fitsCameraFrame,avatarFramePoints,moderatorRearLimit,planCamera,widePose} from '../../src/domain/camera-planner.ts';
import {DEFAULT_DIRECTION,validateDirection} from '../../src/studio/direction.ts';
import {protectStudioCamera} from '../../src/studio/camera-safety.ts';
import {DEFAULT_STUDIO_SCENE} from '../../src/studio/manifest.ts';
const ids=['1','2','3'];
const context:DirectorContext={presentIds:ids,sourceReady:true,layoutMoving:false,canPair:()=>true,splitEnabled:true,canSplit:()=>true};
function active(){const t=new SpeakerTracker();t.update('1','active',0);t.update('2','active',0);return t;}
function established(){const t=active(),d=new ShotDirector();d.update(2500,t,context);d.update(5000,t,context);expect(d.update(7500,t,context).shot.kind).toBe('SPLIT');return {t,d};}
test('10-second detector separates overlap duration, speech occupancy and stable seating order',()=>{
 const t=active(),e=detectDialogue(t,ids,10000);
 expect(e).toMatchObject({pair:['1','2'],spokenMs:[10000,10000],pairShare:1,minorShare:.5,overlapMs:10000,coverageMs:10000,eligible:true,reason:'SUSTAINED_OVERLAP'});
 const latest=detectDialogue(t,ids,30000);expect(latest.spokenMs).toEqual([10000,10000]);
});
test('rapid back-and-forth works without simultaneous speech',()=>{
 const t=new SpeakerTracker();for(const [id,state,at]of [['1','active',0],['1','inactive',2200],['2','active',2200],['2','inactive',4400],['1','active',4400],['1','inactive',6600],['2','active',6600]] as const)t.update(id,state,at);
 const result=detectDialogue(t,ids,9000);expect(result.eligible).toBe(true);expect(result.reason).toBe('RAPID_ALTERNATION');expect(result.alternations).toBe(3);expect(result.overlapMs).toBe(0);
});
test('brief acknowledgements and unbalanced speeches do not request split screen',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);
 for(const at of [1000,2500,4000,5500,7000,8500]){t.update('2','active',at);t.update('2','inactive',at+350);}
 expect(detectDialogue(t,ids,9000).eligible).toBe(false);
 const s=new SpeakerTracker();s.update('1','active',0);s.update('2','active',7500);expect(detectDialogue(s,ids,10000).reason).toBe('BACKCHANNEL_OR_DOMINANCE');
});
test('third participants and source-unknown intervals cannot qualify a two-person scene',()=>{
 const t=active();t.update('3','active',6000);expect(detectDialogue(t,ids,7500).reason).toBe('THIRD_SPEAKER');
 t.update('1','unknown',8000);t.update('2','unknown',8000);expect(detectDialogue(t,ids,8000).eligible).toBe(false);
});
test('split confirmation takes 2.5s and is opt-in rather than changing every two-shot',()=>{
 const t=active(),d=new ShotDirector();expect(d.update(2500,t,context).shot.kind).toBe('TWO_SHOT');expect(d.update(5000,t,context).switchAtMs).toBe(7500);expect(d.update(7499,t,context).shot.kind).toBe('TWO_SHOT');expect(d.update(7500,t,context).shot.kind).toBe('SPLIT');
 const s=active(),off=new ShotDirector();for(const at of [2500,5000,7500,10000])expect(off.update(at,s,{...context,splitEnabled:false}).shot.kind).toBe('TWO_SHOT');
 expect(validateDirection(undefined).splitEnabled).toBe(false);expect(()=>validateDirection({splitEnabled:'yes'})).toThrow('STUDIO_DIRECTION_INVALID');
});
test('split confirms END for 2.5s then waits five seconds, cancels on resumption and applies cooldown',()=>{
 const {t,d}=established();t.update('2','inactive',8000);expect(d.update(8000,t,context).switchAtMs).toBe(10500);
 expect(d.update(10500,t,context).switchAtMs).toBe(15500);expect(d.update(15499,t,context).shot.kind).toBe('SPLIT');
 t.update('2','active',15499);expect(d.update(15499,t,context).shot.kind).toBe('SPLIT');
 t.update('2','inactive',17000);d.update(17000,t,context);expect(d.update(24499,t,context).shot.kind).toBe('SPLIT');expect(d.update(24500,t,context).shot).toEqual({kind:'SINGLE',userIds:['1']});
 t.update('2','active',24501);for(const at of [27001,30000,34499])expect(d.update(at,t,context).shot.kind).not.toBe('SPLIT');
});
test('a qualified third speaker returns to wide after 2.5 seconds',()=>{
 const {t,d}=established();t.update('3','active',8000);d.update(9000,t,context);expect(d.update(10499,t,context).shot.kind).toBe('SPLIT');expect(d.update(10500,t,context).shot.kind).toBe('WIDE');
 t.update('3','inactive',11000);expect(d.update(18499,t,context).shot.kind).toBe('WIDE');expect(d.update(18500,t,context).shot.kind).toBe('TWO_SHOT');
});
test('manual selection is immediate, fixed mode wins and unsafe splits fall back',()=>{
 const {t,d}=established();d.manual({kind:'SINGLE',userIds:['3']},7600);expect(d.current().userIds).toEqual(['3']);expect(d.autoResumeAtMs).toBe(17600);expect(d.update(15000,t,context).shot.kind).toBe('SINGLE');
 d.setMode('HOLD');expect(d.update(50000,t,context).shot.userIds).toEqual(['3']);
 const s=active(),safe=new ShotDirector();safe.update(2500,s,context);expect(safe.update(10000,s,{...context,canSplit:()=>false}).shot.kind).not.toBe('SPLIT');expect(safe.update(10000,s,{...context,canSplit:()=>false}).dialogue?.reason).toBe('SPLIT_NO_SAFE_FRAMING');
});
test('split portrait framing uses 8:9, near clipping and the moderator-front constraint',()=>{
 const layout=makeLayout(6),seats=new Map(layout.seats.map((s,i)=>[String(i),s]));const rear=moderatorRearLimit(layout.straightLength);
 for(const pair of [['1','2'],['1','3'],['0','2']] as [string,string][]){
  const panels=splitPanelCameras(pair,seats,layout.straightLength);expect(panels).not.toBeNull();
  for(const panel of panels!){expect(panel.pose.position[2]).toBeGreaterThanOrEqual(rear);expect(fitsCameraFrame(panel.pose,avatarFramePoints(seats.get(panel.userId)!,{halfWidth:.28,topY:1.53,bottomY:.97}),.9,DEFAULT_DIRECTION.nearClip,8/9)).toBe(true);}
 }
 const wide=widePose(layout.straightLength),initial={id:0,shot:{kind:'WIDE',userIds:[]} as const,reason:'test',transition:'CUT' as const,from:wide,to:wide,startMs:0,durationMs:0};
 const plan=planCamera({...initial,shot:{kind:'WIDE',userIds:[]}},{kind:'SPLIT',userIds:['1','2']},'split',seats,6,layout.straightLength,0);
 const panel=plan.panels![1]!.pose.position;
 const scene={...DEFAULT_STUDIO_SCENE,camera:{blockers:[{id:'wall',min:panel.map(x=>x-.2) as [number,number,number],max:panel.map(x=>x+.2) as [number,number,number]}]}};
 expect(protectStudioCamera(plan,scene,wide).shot.kind).toBe('WIDE');expect(protectStudioCamera(plan,scene,wide).panels).toBeUndefined();
});

test('crowd-to-split transition also confirms END before its five-second grace',()=>{
 const t=active(),d=new ShotDirector();d.update(2500,t,context);t.update('3','active',5000);d.update(5000,t,context);d.update(6000,t,context);expect(d.update(7500,t,context).shot.kind).toBe('WIDE');
 t.update('3','inactive',8000);d.update(8000,t,context);d.update(10500,t,context);expect(d.update(15499,t,context).shot.kind).toBe('WIDE');expect(d.update(15500,t,context).shot.kind).toBe('SPLIT');
});


test('a 2499ms third-speaker interjection cancels its pending wide without changing sides',()=>{
 const {t,d}=established();t.update('3','active',8000);
 expect(d.update(9000,t,context).switchAtMs).toBe(10500);
 expect(d.update(10499,t,context).shot).toEqual({kind:'SPLIT',userIds:['1','2']});
 t.update('3','inactive',10499);
 expect(d.update(10500,t,context).pendingShot).toBeUndefined();
 expect(d.update(15000,t,context).shot).toEqual({kind:'SPLIT',userIds:['1','2']});
});
test('a fourth START cannot postpone an already established third speaker',()=>{
 const {t,d}=established(),ctx={...context,presentIds:['1','2','3','4']};
 t.update('3','active',8000);t.update('4','active',8500);d.update(9500,t,ctx);
 expect(d.update(10499,t,ctx).shot.kind).toBe('SPLIT');
 expect(d.update(10500,t,ctx).shot.kind).toBe('WIDE');
 expect(d.update(11000,t,ctx).reason).toBe('THREE_PERSON_DISCUSSION');
});
test('a third speaker taking the floor gets a single only after the former pair STOP grace',()=>{
 const {t,d}=established();t.update('1','inactive',8000);t.update('2','inactive',8000);t.update('3','active',8000);
 d.update(9000,t,context);expect(d.update(10500,t,context).shot.kind).toBe('WIDE');
 expect(d.update(15499,t,context).reason).toBe('THIRD_SPEAKER_END_GRACE');
 expect(d.update(15500,t,context).shot).toEqual({kind:'SINGLE',userIds:['3']});
});
test('a three-person wide waits for STOP, cancels on renewed speech and does not immediately re-split',()=>{
 const {t,d}=established();t.update('3','active',8000);d.update(9000,t,context);d.update(10500,t,context);
 t.update('3','inactive',11000);expect(d.update(15999,t,context).shot.kind).toBe('WIDE');
 t.update('3','active',15999);expect(d.update(15999,t,context).reason).toBe('THREE_PERSON_DISCUSSION');
 t.update('3','inactive',18000);expect(d.update(25499,t,context).shot.kind).toBe('WIDE');
 expect(d.update(25500,t,context).shot).toEqual({kind:'TWO_SHOT',userIds:['1','2']});
 for(const at of [27500,32500,35499])expect(d.update(at,t,context).shot.kind).toBe('TWO_SHOT');
 d.update(35500,t,context);expect(d.update(38000,t,context).shot.kind).toBe('SPLIT');
});
test('a departing member waits five seconds before a new pair is selected',()=>{
 const {t,d}=established();t.update('3','active',8000);d.update(9000,t,context);d.update(10500,t,context);
 t.update('2','inactive',11000);expect(d.update(18499,t,context).shot.kind).toBe('WIDE');
 expect(d.update(18500,t,context).shot).toEqual({kind:'TWO_SHOT',userIds:['1','3']});
 expect(d.update(20000,t,context).shot.kind).toBe('TWO_SHOT');
});
test('active three-person conversation cannot be collapsed by ten-second dominance scores',()=>{
 const {t,d}=established();t.update('3','active',8000);d.update(9000,t,context);d.update(10500,t,context);
 t.update('2','inactive',11000);t.update('2','active',15500);
 for(const at of [16500,18000,19000])expect(d.update(at,t,context).shot.kind).toBe('WIDE');
 d.manual({kind:'SINGLE',userIds:['3']},19001);expect(d.current().userIds).toEqual(['3']);
});
