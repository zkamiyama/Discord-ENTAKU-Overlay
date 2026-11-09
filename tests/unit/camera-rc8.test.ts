import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {DEFAULT_DIRECTION,validateDirection} from '../../src/studio/direction.ts';
import {DEFAULT_QUALITY,validateQuality,effectiveSamples} from '../../src/studio/quality.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';
import {widePose,avatarFramePoints,fitsCameraFrame,shotPose} from '../../src/domain/camera-planner.ts';
function engine(){const e=new AppEngine({source:'demo',serverEpoch:'clock'});for(const event of demoEvents())e.apply(event);e.tick(2000);return e;}
test('manual lease lives on the server, renews and survives settings snapshots',()=>{
 const e=engine();const id=e.snapshot().participants[1]!.userId;
 e.control({type:'shot',shot:{kind:'SINGLE',userIds:[id]}},0,2100);
 expect(e.snapshot().autoResumeAtMs).toBe(12100);e.tick(12099);expect(e.snapshot().mode).toBe('MANUAL');
 e.tick(12100);expect(e.snapshot().mode).toBe('AUTO');expect(e.snapshot().camera.shot.userIds).toEqual([id]);
 expect(e.snapshot().decision.switchAtMs).toBe(17100);e.tick(17099);expect(e.snapshot().camera.shot.kind).toBe('SINGLE');
 e.tick(17100);expect(e.snapshot().camera.shot.kind).toBe('WIDE');
});
test('queued shots start the lease on execution; AUTO off cancels a deadline',()=>{
 const e=new AppEngine({source:'demo',serverEpoch:'queued'});for(const event of demoEvents())e.apply(event);
 const id=e.snapshot().participants[1]!.userId;e.control({type:'shot',shot:{kind:'SINGLE',userIds:[id]}},0,100);
 expect(e.snapshot().autoResumeAtMs).toBeNull();e.tick(2000);expect(e.snapshot().autoResumeAtMs).toBe(12000);
 e.control({type:'mode',mode:'HOLD'},e.snapshot().revision,2500);e.tick(30000);expect(e.snapshot().mode).toBe('HOLD');expect(e.snapshot().autoResumeAtMs).toBeNull();
});
test('direction settings migrate and do not reset the active shot',()=>{
 expect(validateDirection(undefined)).toEqual(DEFAULT_DIRECTION);
 for(const value of [{manualReturnSeconds:0},{portraitFov:60},{wideHeightRatio:NaN},{unknown:1}])expect(()=>validateDirection(value)).toThrow('STUDIO_DIRECTION_INVALID');
 const e=engine();const before=e.snapshot();e.setStudioScene({...before.studio,direction:validateDirection({manualReturnSeconds:3})},before.revision,2100);
 expect(e.snapshot().camera).toEqual(before.camera);
 e.control({type:'shot',shot:{kind:'SINGLE',userIds:[e.snapshot().participants[1]!.userId]}},e.snapshot().revision,2200);expect(e.snapshot().autoResumeAtMs).toBe(5200);
});
test('low adaptive wide contains all supported seats and large avatars with a margin',()=>{
 for(let n=4;n<=32;n++)for(const tall of [false,true]){
  const l=makeLayout(n),extent={halfWidth:tall?1.4:.28,topY:tall?3:1.53,bottomY:.4},z=3.7;
  const seats=l.seats.map(s=>({...s,position:[s.position[0],s.position[1],s.position[2]+z] as const,faceAnchor:[s.faceAnchor[0],s.faceAnchor[1],s.faceAnchor[2]+z] as const}));
  const low=widePose(l.straightLength,[extent],z),high=widePose(l.straightLength,[extent],z,1);
  expect(low.position[1]).toBeCloseTo(Math.max(1.1,high.position[1]*.3),8);
  expect(fitsCameraFrame(low,seats.flatMap(s=>avatarFramePoints(s,extent)),.87)).toBe(true);
  expect(low.fov).toBe(45);
 }
});
test('telephoto single stays behind the foreground and respects custom FOV',()=>{
 const l=makeLayout(6),m=new Map(l.seats.map((s,i)=>[String(i),s]));
 for(const fov of [18,22,28]){
  const p=shotPose({kind:'SINGLE',userIds:['1']},m,l.straightLength,new Map(),0,{...DEFAULT_DIRECTION,portraitFov:fov});
  expect(p.fov).toBeLessThanOrEqual(fov+4);expect(p.position[0]).toBeGreaterThan(m.get('2')!.faceAnchor[0]+1.5);
 }
});
test('2x and eight shadow lights are supported without misreporting hardware samples',()=>{
 expect(validateQuality({msaa:2,shadowLights:8})).toMatchObject({msaa:2,shadowLights:8});expect(DEFAULT_QUALITY.msaa).toBe(4);
 expect(effectiveSamples(2,[8,4,2],8)).toBe(2);expect(effectiveSamples(2,[4],4)).toBe(4);
 expect(effectiveSamples(8,[4,2],4)).toBe(4);expect(effectiveSamples(0,[4],4)).toBe(0);expect(effectiveSamples(2,[],4)).toBe(0);
});

test('camera settings do not reload a studio or force a transient loading wide',async()=>{
 const {StudioVisual}=await import('../../src/web/studio/visual.ts');const {DEFAULT_STUDIO_SCENE}=await import('../../src/studio/manifest.ts');
 const visual=new StudioVisual({} as any,{} as any),scene={...DEFAULT_STUDIO_SCENE,broadcast:{enabled:false,title:'',subtitle:''}};
 await visual.update(scene);const before=visual.renderGeneration;
 await visual.update({...scene,revision:1,direction:{...DEFAULT_DIRECTION,manualReturnSeconds:20}});
 expect(visual.renderGeneration).toBe(before);expect(visual.loading).toBe(false);visual.dispose();
});
