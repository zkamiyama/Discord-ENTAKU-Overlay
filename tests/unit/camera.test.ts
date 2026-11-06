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
