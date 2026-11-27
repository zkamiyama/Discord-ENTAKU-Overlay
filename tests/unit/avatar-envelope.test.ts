import {expect,test} from 'bun:test';
import {AvatarEnvelope} from '../../src/web/overlay/avatar-envelope.ts';

test('speech attack and release depend on elapsed time at 2, 30, 60 and 144 fps',()=>{
 const samples=[2,30,60,144].map(fps=>{
  const envelope=new AvatarEnvelope();
  for(let frame=1;frame<=fps;frame++)envelope.update({presence:'present',speaking:'active'},1/fps,frame*1000/fps,true);
  const active={opacity:envelope.opacity,glow:envelope.glow,intensity:envelope.intensity};
  for(let frame=1;frame<=fps*2;frame++)envelope.update({presence:'present',speaking:'inactive'},1/fps,1000+frame*1000/fps,true);
  return {active,stopped:envelope.intensity};
 });
 for(const sample of samples){
  expect(sample.active.opacity).toBeCloseTo(samples[0]!.active.opacity,10);
  expect(sample.active.glow).toBeCloseTo(samples[0]!.active.glow,10);
  expect(sample.active.intensity).toBeCloseTo(samples[0]!.active.intensity,10);
  expect(sample.stopped).toBe(0);
 }
});

test('a suspended renderer catches up presence and speech without residual light',()=>{
 const envelope=new AvatarEnvelope();
 envelope.update({presence:'present',speaking:'active'},1,1000,true);
 expect(envelope.intensity).toBeGreaterThan(.8);
 envelope.update({presence:'stale',speaking:'active'},2,3000,false);
 expect(envelope.opacity).toBeCloseTo(.45,3);
 expect(envelope.intensity).toBe(0);
 envelope.update({presence:'absent',speaking:'inactive'},60,63000,false);
 expect(envelope.opacity).toBeLessThan(.005);
 expect(envelope.intensity).toBe(0);
 envelope.update({presence:'present',speaking:'active'},1,64000,true);
 expect(envelope.opacity).toBeGreaterThan(.99);
 expect(envelope.intensity).toBeGreaterThan(.8);
});
