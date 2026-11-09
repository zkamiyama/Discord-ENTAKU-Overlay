import {expect,test} from 'bun:test';
import {makeLayout,perimeter,pointAtDistance} from '../../src/geometry/capsule.ts';
import {DEFAULT_DIRECTION,validateDirection} from '../../src/studio/direction.ts';
import {widePose,wideFaces,shotPose,planCamera,samplePlan,moderatorRearLimit,fitsCameraFrame,avatarFramePoints} from '../../src/domain/camera-planner.ts';
import type {CameraPlan} from '../../src/contracts/domain.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';

test('wide stays on the moderator axis and fits actual people and nameplates with five percent border',()=>{
 for(const count of [4,5,6,8,16,32])for(const hosts of [[0],[0,1]])for(const tall of [false,true]){
  const l=makeLayout(count,1.1,hosts),m=new Map(l.seats.map((s,i)=>[String(i),s]));
  const e={halfWidth:tall?.8:.28,topY:tall?2.7:1.53,bottomY:.8},extents=new Map([...m.keys()].map(id=>[id,e]));
  const pose=widePose(l.straightLength,extents.values(),0,.3,wideFaces(m,extents));
  expect(pose.position[0]).toBe(0);expect(pose.target[0]).toBe(0);expect(pose.position[2]).toBeGreaterThan(pose.target[2]);
  expect(fitsCameraFrame(pose,[...m.values()].flatMap(s=>avatarFramePoints(s,e)),.91)).toBe(true);
  // Include the tabletop: it may set the minimum camera distance before faces do.
  const bounds=[...m.values()].flatMap(s=>avatarFramePoints(s,e));
  for(let i=0;i<48;i++){const p=pointAtDistance(1.44,l.straightLength,perimeter(1.44,l.straightLength)*i/48);bounds.push([p.x,.685,p.z]);}
  expect(fitsCameraFrame({...pose,position:[0,pose.position[1],pose.position[2]-.20]},bounds,.90)).toBe(false);
 }
});
test('all single cameras and sampled MOVE paths stay in front of the moderator rear plane',()=>{
 for(const count of [4,5,6,8,16,32])for(const hosts of [[0],[0,1]]){
  const l=makeLayout(count,1.1,hosts),m=new Map(l.seats.map((s,i)=>[String(i),s])),rear=moderatorRearLimit(l.straightLength);
  let pose=widePose(l.straightLength),previous:CameraPlan={id:0,shot:{kind:'WIDE',userIds:[]},reason:'test',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
  for(let i=0;i<count;i++){
   const next=planCamera(previous,{kind:'SINGLE',userIds:[String(i)]},'test',m,l.straightLength,i*5000);
   expect(next.to.position[2]).toBeGreaterThanOrEqual(rear-1e-9);
   for(let n=0;n<=16;n++)expect(samplePlan(next,next.startMs+next.durationMs*n/16).position[2]).toBeGreaterThanOrEqual(rear-1e-9);
   previous=next;
  }
 }
});
test('near clip is validated, migrated and respected when framing a subject',()=>{
 expect(validateDirection({manualReturnSeconds:10}).nearClip).toBe(.15);
 for(const near of [0,-1,NaN,Infinity,2])expect(()=>validateDirection({nearClip:near})).toThrow('STUDIO_DIRECTION_INVALID');
 const l=makeLayout(6),m=new Map(l.seats.map((s,i)=>[String(i),s]));
 for(const nearClip of [.02,.15,1]){
  const pose=shotPose({kind:'SINGLE',userIds:['1']},m,l.straightLength,new Map(),0,{...DEFAULT_DIRECTION,nearClip});
  expect(fitsCameraFrame(pose,avatarFramePoints(m.get('1')!,{halfWidth:.28,topY:1.53,bottomY:.97}),.9,nearClip)).toBe(true);
 }
});
test('custom safeWide behind moderators is rejected, including with a transformed studio anchor',()=>{
 const e=new AppEngine({source:'demo',serverEpoch:'test'});for(const event of demoEvents())e.apply(event);e.tick(2000);
 const state=e.snapshot(),rear=moderatorRearLimit(state.straightLength,state.deskOffsetZ??0);
 e.setStudioScene({...state.studio,tableAnchor:{position:[20,2,10],yawDeg:90},camera:{blockers:[{id:'enclose',min:[-100,-100,-100],max:[100,100,100]}],safeWide:{position:[0,3,rear-4],target:[0,1,0],fov:45}}},state.revision,2100);
 e.control({type:'shot',shot:{kind:'SINGLE',userIds:[state.participants[2]!.userId]}},e.snapshot().revision,3500);e.tick(4000);
 expect(e.snapshot().camera.to.position[2]).toBeGreaterThanOrEqual(rear);
 expect(e.snapshot().camera.to.position[0]).toBe(0);
});
