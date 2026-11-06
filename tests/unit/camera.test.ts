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
test('custom avatar framing includes the closer nameplate and the yaw envelope', async () => {
  const { fitsCameraFrame, avatarFramePoints, shotPose } = await import('../../src/domain/camera-planner.ts');
  const { makeLayout } = await import('../../src/geometry/capsule.ts');
  for(const capacity of [4,8,16,32])for(const seat of makeLayout(capacity).seats){
    const extent={halfWidth:.49,topY:2.4,bottomY:.3};
    const pose=shotPose({kind:'SINGLE',userIds:['1']},new Map([['1',seat]]),makeLayout(capacity).straightLength,new Map([['1',extent]]));
    expect(fitsCameraFrame(pose,avatarFramePoints(seat,extent))).toBe(true);
  }
});


test('opposed discussion and same-side dialogue widen with MOVE and exact endpoints',()=>{
 for(const n of [5,6,8,16,32]){
  const l=makeLayout(n),m=new Map(l.seats.map((s,i)=>[String(i),s]));
  for(const pair of [['1','2'],['1','3']] as [string,string][]){
   const solo:Shot={kind:'SINGLE',userIds:[pair[0]]},pose=shotPose(solo,m,l.straightLength);
   const previous:CameraPlan={id:1,shot:solo,reason:'TEST',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
   const plan=planCamera(previous,{kind:'TWO_SHOT',userIds:pair},'NEARBY_DIALOGUE',m,n,l.straightLength,1000);
   expect(plan.transition).toBe('MOVE');expect(plan.durationMs).toBeGreaterThanOrEqual(1200);
   expect(samplePlan(plan,1000)).toEqual(plan.from);expect(samplePlan(plan,1000+plan.durationMs)).toEqual(plan.to);
   expect(samplePlan(plan,1000+plan.durationMs/2)).not.toEqual(plan.to);
  }
 }
});
test('an unrelated far-side subject does not cause a camera fly-through',()=>{
 const l=makeLayout(16),m=new Map(l.seats.map((s,i)=>[String(i),s]));
 const solo:Shot={kind:'SINGLE',userIds:['1']},pose=shotPose(solo,m,l.straightLength);
 const p:CameraPlan={id:1,shot:solo,reason:'TEST',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};
 expect(planCamera(p,{kind:'SINGLE',userIds:['14']},'TEST',m,16,l.straightLength,1000).transition).toBe('CUT');
 expect(planCamera(p,{kind:'TWO_SHOT',userIds:['11','13']},'TEST',m,16,l.straightLength,1000).transition).toBe('CUT');
});
