import { expect,test } from 'bun:test';
import { makeLayout } from '../../src/geometry/capsule.ts';
import { planCamera,samplePlan,shotPose,widePose } from '../../src/domain/camera-planner.ts';
import type { CameraPlan,Shot } from '../../src/contracts/domain.ts';
test('camera plans and interpolation are finite for all supported capacities',()=>{
 for(let n=4;n<=32;n++) {
  const l=makeLayout(n),map=new Map(l.seats.map((s,i)=>[String(i),s]));
  const shot:Shot={kind:'SINGLE',userIds:['0']},pose=shotPose(shot,map,l.straightLength);
  const previous:CameraPlan={id:1,shot,reason:'TEST',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
  const plan=planCamera(previous,{kind:'SINGLE',userIds:['1']},'TEST',map,n,l.straightLength,1000);
  for(const time of [500,1000,1450,1900,2500]) expect([...samplePlan(plan,time).position,...samplePlan(plan,time).target].every(Number.isFinite)).toBe(true);
  expect(plan.to.position[1]).toBeGreaterThan(0.87);
  expect(widePose(l.straightLength).fov).toBe(45);
 }
});
test('far seats use CUT, and a safe neighboring pair can use MOVE',()=>{
 const l=makeLayout(16),map=new Map(l.seats.map((s,i)=>[String(i),s]));
 const shot:Shot={kind:'SINGLE',userIds:['0']},pose=shotPose(shot,map,l.straightLength);
 const prior:CameraPlan={id:1,shot,reason:'TEST',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
 expect(planCamera(prior,{kind:'SINGLE',userIds:['8']},'TEST',map,16,l.straightLength,1000).transition).toBe('CUT');
 const plans=l.seats.map((_,i)=>{const s:Shot={kind:'SINGLE',userIds:[String(i)]},p=shotPose(s,map,l.straightLength);return planCamera({...prior,shot:s,from:p,to:p},{kind:'SINGLE',userIds:[String((i+1)%16)]},'TEST',map,16,l.straightLength,1000);});
 expect(plans.some(p=>p.transition==='MOVE')).toBe(true);
});
test('custom avatar framing includes the closer nameplate and the yaw envelope', async () => {
  const { fitsCameraFrame, avatarFramePoints, shotPose } = await import('../../src/domain/camera-planner.ts');
  const { makeLayout } = await import('../../src/geometry/capsule.ts');
  for(const capacity of [4,8,16,32])for(const seat of makeLayout(capacity).seats){
    const extent={halfWidth:.49,topY:2.4,bottomY:.3};
    const pose=shotPose({kind:'SINGLE',userIds:['1']},new Map([['1',seat]]),makeLayout(capacity).straightLength,new Map([['1',extent]]));
    expect(fitsCameraFrame(pose,avatarFramePoints(seat,extent))).toBe(true);
  }
});

test('SINGLE grows into a nearby TWO_SHOT by an eased camera move, not an instant cut',()=>{
 for(const n of [6,8,12,16,24,32]){
   const layout=makeLayout(n),byUser=new Map(layout.seats.map((seat,i)=>[String(i),seat]));
   for(let i=0;i<n;i++){
     const first=String(i),second=String((i+1)%n);
     const fromShot:Shot={kind:'SINGLE',userIds:[first]},targetShot:Shot={kind:'TWO_SHOT',userIds:[first,second]};
     const firstPose=shotPose(fromShot,byUser,layout.straightLength);
     const initial:CameraPlan={id:1,shot:fromShot,reason:'INITIAL',transition:'CUT',from:firstPose,to:firstPose,startMs:0,durationMs:0};
     const result=planCamera(initial,targetShot,'NEARBY_DIALOGUE',byUser,n,layout.straightLength,3500);
     expect(result.transition).toBe('MOVE');
     expect(result.durationMs).toBeGreaterThanOrEqual(1200);
     expect(result.durationMs).toBeLessThanOrEqual(1600);
     expect(samplePlan(result,3500).position).toEqual(firstPose.position);
     expect(samplePlan(result,3500+result.durationMs).position).toEqual(result.to.position);
     expect(samplePlan(result,4100).position).not.toEqual(firstPose.position);
     const back=planCamera({...result,id:result.id+1,from:result.to,to:result.to,durationMs:0},fromShot,'SPEAKER_QUALIFIED',byUser,n,layout.straightLength,7500);
     expect(back.transition).toBe('MOVE');
     expect(back.durationMs).toBeGreaterThanOrEqual(950);
     expect(back.durationMs).toBeLessThanOrEqual(1400);
   }
 }
});
test('unrelated or distant TWO_SHOT changes remain CUTs',()=>{
 const layout=makeLayout(16),byUser=new Map(layout.seats.map((s,i)=>[String(i),s]));
 const original:Shot={kind:'SINGLE',userIds:['0']},pose=shotPose(original,byUser,layout.straightLength);
 const prev:CameraPlan={id:1,shot:original,reason:'TEST',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
 expect(planCamera(prev,{kind:'TWO_SHOT',userIds:['7','8']},'OTHER',byUser,16,layout.straightLength,4000).transition).toBe('CUT');
 expect(planCamera(prev,{kind:'TWO_SHOT',userIds:['0','8']},'DISTANT',byUser,16,layout.straightLength,4000).transition).toBe('CUT');
});

test('wide custom avatars still dolly out to a nearby pair without an abrupt cut',()=>{
  const layout=makeLayout(6),byUser=new Map(layout.seats.map((seat,i)=>[String(i),seat]));
  const extents=new Map([['0',{halfWidth:1.6,topY:2.4,bottomY:0.5}],['1',{halfWidth:1.6,topY:2.4,bottomY:0.5}]]);
  const solo:Shot={kind:'SINGLE',userIds:['0']},pose=shotPose(solo,byUser,layout.straightLength,extents);
  const previous:CameraPlan={id:1,shot:solo,reason:'TEST',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
  const next=planCamera(previous,{kind:'TWO_SHOT',userIds:['0','1']},'NEARBY_DIALOGUE',byUser,6,layout.straightLength,2000,extents);
  expect(next.transition).toBe('MOVE');
  expect(next.durationMs).toBe(1600);
});
