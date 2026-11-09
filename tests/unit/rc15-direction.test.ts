import {expect,test} from 'bun:test';
import {DEFAULT_DIRECTION,validateDirection} from '../../src/studio/direction.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_EXPOSURE} from '../../src/studio/exposure.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
import {ShotDirector,type DirectorContext} from '../../src/domain/shot-director.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';
import {adjacentSeats} from '../../src/geometry/seat-relations.ts';
import {pairPose,avatarFramePoints,fitsCameraFrame} from '../../src/domain/camera-planner.ts';
import {naturalVibrance} from '../../src/web/studio/vibrance-shader.ts';
const ctx:DirectorContext={presentIds:['1','2','3'],sourceReady:true,layoutMoving:false,canPair:()=>true};
test('RC15 defaults match the requested onsets, image grade and eight-light quality',()=>{
 expect(DEFAULT_DIRECTION).toMatchObject({startGraceSeconds:1.5,endConfirmSeconds:2.5,endGraceSeconds:5,leadershipWindowSeconds:10,splitEnabled:true});
 expect(DEFAULT_QUALITY).toMatchObject({nameplates:'blue',shadows:'soft',shadowSize:1024,shadowLights:8,ao:'gtao',reflections:true,fxaa:true});
 expect(DEFAULT_POST).toMatchObject({saturation:1.2,contrast:1.1,excludeAvatars:true});expect(DEFAULT_EXPOSURE.compensationEV).toBe(.5);
 for(const input of [{startGraceSeconds:NaN},{endConfirmSeconds:-1},{endGraceSeconds:16},{leadershipWindowSeconds:31}])expect(()=>validateDirection(input)).toThrow('STUDIO_DIRECTION_INVALID');
});
test('default onset is exactly 1500ms; configurable onset and both end phases use one clock',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);
 expect(d.update(1499,t,ctx).shot.kind).toBe('WIDE');expect(d.update(1500,t,ctx).shot.kind).toBe('SINGLE');
 for(const onset of [.5,1.5,3]){
  const setting=validateDirection({startGraceSeconds:onset,endConfirmSeconds:1,endGraceSeconds:2});
  const a=new SpeakerTracker(setting),b=new ShotDirector(setting);a.update('1','active',0);a.update('2','active',0);
  expect(b.update(onset*1000-1,a,ctx).shot.kind).toBe('WIDE');expect(b.update(onset*1000,a,ctx).shot.kind).toBe('TWO_SHOT');
  a.update('2','inactive',5000);expect(b.update(5999,a,ctx).reason).toBe('SPEECH_END_CONFIRM');
  expect(b.update(6000,a,ctx).switchAtMs).toBe(8000);expect(b.update(7999,a,ctx).shot.kind).toBe('TWO_SHOT');expect(b.update(8000,a,ctx).shot.userIds).toEqual(['1']);
 }
});
test('changing integration window uses retained intervals, never silence, and can change leadership',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);t.update('1','inactive',7000);t.update('2','active',7000);
 expect(t.stats('1',12000).windowMs).toBe(5000);expect(t.stats('2',12000).windowMs).toBe(5000);
 t.configure(validateDirection({leadershipWindowSeconds:3}));expect(t.stats('1',12000).windowMs).toBe(0);expect(t.stats('2',12000).windowMs).toBe(3000);
 t.configure(validateDirection({leadershipWindowSeconds:20}));expect(t.stats('1',12000).windowMs).toBe(7000);expect(t.stats('2',12000).windowMs).toBe(5000);
 const d=new ShotDirector(validateDirection({leadershipWindowSeconds:3}));t.configure(validateDirection({leadershipWindowSeconds:3}));expect(d.update(12000,t,ctx).leaderUserId).toBe('2');
});
test('adjacent cohosts and same-row neighbours use a central pair, opposite rows may split',()=>{
 const layout=makeLayout(8,1.1,[0,1]),hosts=layout.seats.slice(0,2),ext={halfWidth:.28,topY:1.53,bottomY:.97};
 expect(hosts.every(s=>s.baseYawRad===0)).toBe(true);expect(Math.abs(hosts[0]!.position[0]-hosts[1]!.position[0])).toBeCloseTo(1.1,9);
 expect(adjacentSeats(hosts[0]!,hosts[1]!)).toBe(true);expect(adjacentSeats(layout.seats[2]!,layout.seats[4]!)).toBe(true);expect(adjacentSeats(layout.seats[2]!,layout.seats[3]!)).toBe(false);
 const pose=pairPose(hosts[0]!,hosts[1]!,[ext,ext])!;expect(pose.position[0]).toBe(0);expect(pose.target[0]).toBe(0);expect(fitsCameraFrame(pose,hosts.flatMap(s=>avatarFramePoints(s,ext)),.86)).toBe(true);
 for(const neighbours of [false,true]){
  const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);t.update('2','active',0);
  const c={...ctx,splitEnabled:true,canSplit:()=>true,preferPair:()=>neighbours};
  for(const time of [1500,5000,6500,10000])d.update(time,t,c);
  expect(d.current().kind).toBe(neighbours?'TWO_SHOT':'SPLIT');
 }
});
test('framing edits immediately replan a manual camera without changing seats or its lease',()=>{
 const e=new AppEngine({source:'demo',serverEpoch:'rc15'});for(const event of demoEvents())e.apply(event);e.tick(3000);
 const id=e.snapshot().participants[1]!.userId;e.control({type:'shot',shot:{kind:'SINGLE',userIds:[id]}},0,3100);
 const before=e.snapshot();e.setStudioScene({...before.studio,direction:validateDirection({...before.studio.direction,portraitFov:30})},before.revision,3200);
 const after=e.snapshot();expect(after.camera.id).toBeGreaterThan(before.camera.id);expect(after.camera.to.fov).not.toBe(before.camera.to.fov);expect(after.mode).toBe('MANUAL');expect(after.autoResumeAtMs).toBe(before.autoResumeAtMs);expect(after.session).toEqual(before.session);
 e.control({type:'shot',shot:{kind:'WIDE',userIds:[]}},after.revision,3300);const wide=e.snapshot();
 e.setStudioScene({...wide.studio,direction:validateDirection({...wide.studio.direction,wideHeightRatio:.9})},wide.revision,3400);expect(e.snapshot().camera.to.position[1]).toBeGreaterThan(wide.camera.to.position[1]);
});
test('natural vibrance boosts muted colors more, preserves luminance, gray and in-gamut saturated colors',()=>{
 const muted=[.5,.4,.3],strong=[.95,.15,.05],delta=(c:number[])=>naturalVibrance(c,1.2).reduce((n,v,i)=>n+Math.abs(v-c[i]!),0);
 expect(delta(muted)).toBeGreaterThan(delta(strong)*3);
 const y=(c:readonly number[])=>.2126*c[0]!+.7152*c[1]!+.0722*c[2]!;
 for(const rgb of [muted,strong,[1,0,0],[.4,.4,.4]])for(const amount of [0,1,1.2,2]){
  const out=naturalVibrance(rgb,amount);expect(y(out)).toBeCloseTo(y(rgb),10);expect(out.every(v=>v>=0&&v<=1)).toBe(true);
 }
 expect(naturalVibrance([1,0,0],2)).toEqual([1,0,0]);expect(naturalVibrance([.4,.4,.4],2)).toEqual([.4,.4,.4]);
});
