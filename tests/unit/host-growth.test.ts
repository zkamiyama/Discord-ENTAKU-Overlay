import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoParticipant} from '../../src/replay/demo.ts';
import {makeLayout,makeSessionLayout} from '../../src/geometry/capsule.ts';
import {newSession,SeatAllocator,validateSession} from '../../src/domain/seat-allocator.ts';
import {NAMEPLATE,MICROPHONE,platePosition} from '../../src/geometry/desk-props.ts';
import {validateQuality,DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {widePose,fitsCameraFrame,avatarFramePoints} from '../../src/domain/camera-planner.ts';
const snapshot=(n:number,time:number)=>({type:'snapshot' as const,channel:{channelId:'200',name:'test',kind:'guild-voice' as const},participants:Array.from({length:n},(_,i)=>({...demoParticipant(String(i+1)),channelId:'200'})),sourceGeneration:1,receivedAtMs:time});
test('five to 32 seats grow only forward; host and existing pairs stay at the same position',()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'anchor'});engine.apply(snapshot(5,0));engine.tick(2000);
 const initial=engine.snapshot(),host=initial.seats[0]!,rear=(initial.deskOffsetZ??0)-initial.straightLength/2;
 for(let count=6;count<=32;count++){
  engine.apply(snapshot(count,count*3000));const s=engine.snapshot();
  for(let axis=0;axis<3;axis++)expect(s.seats[0]!.position[axis]).toBeCloseTo(host.position[axis]!,10);
  expect((s.deskOffsetZ??0)-s.straightLength/2).toBeCloseTo(rear,10);
  for(const i of [1,2,3,4])expect(s.seats[i]!.position[2]).toBeCloseTo(initial.seats[i]!.position[2],8);
  const wide=widePose(s.straightLength,[],s.deskOffsetZ??0);
  expect(fitsCameraFrame(wide,s.seats.flatMap(seat=>avatarFramePoints(seat,{halfWidth:.28,topY:1.53,bottomY:.97})),.96)).toBe(true);
  const motion=s.layoutMotion!;
  for(const t of [.2,.5,.8])expect((motion.fromDeskOffsetZ??0)*(1-t)+(s.deskOffsetZ??0)*t-(motion.fromStraightLength*(1-t)+s.straightLength*t)/2).toBeCloseTo(rear,8);
 }
 const large=engine.snapshot();engine.apply(snapshot(5,110000));expect(engine.snapshot().seats).toEqual(large.seats);
 const restored=new AppEngine({source:'demo',serverEpoch:'restore',sessions:engine.sessions()});restored.apply(snapshot(32,0));expect(restored.snapshot().seats).toEqual(large.seats);
});
test('legacy session captures its existing rear arc before a larger first snapshot',()=>{
 const a=new SeatAllocator(newSession('200','old',5));a.updatePresent(['1','2','3','4','5'],'2026-11-08T00:00:00Z');const original=makeSessionLayout(a.snapshot());a.retainLength(original.straightLength);
 const engine=new AppEngine({source:'demo',serverEpoch:'migrate',sessions:[a.snapshot()]});engine.apply(snapshot(9,0));
 expect(engine.snapshot().seats[0]!.position).toEqual(original.seats[0]!.position);
 expect(engine.snapshot().session.growthAnchorLength).toBe(original.straightLength);
 expect(()=>validateSession({...a.snapshot(),growthAnchorLength:-1})).toThrow('INVALID_GROWTH_ANCHOR');
});
test('all nameplate corners and microphone bases stay within the wood tabletop',()=>{
 for(let n=1;n<=32;n++)for(const hosts of [[0],[0,Math.min(n-1,1)]]){
  const layout=makeLayout(n,1.1,hosts);
  for(const seat of layout.seats){
   const origin=platePosition(seat),tangent=[Math.cos(seat.baseYawRad),-Math.sin(seat.baseYawRad)];
   const local:Array<[number,number]>=[];
   for(const x of [-NAMEPLATE.width/2,NAMEPLATE.width/2])for(const z of [-NAMEPLATE.baseDepth/2,NAMEPLATE.baseDepth/2])local.push([x,z]);
   for(let i=0;i<24;i++)local.push([MICROPHONE.x+MICROPHONE.baseRadius*Math.cos(i/24*2*Math.PI),MICROPHONE.z+MICROPHONE.baseRadius*Math.sin(i/24*2*Math.PI)]);
   for(const [x,z]of local){
    const wx=origin[0]+tangent[0]!*x+seat.inward[0]*z,wz=origin[2]+tangent[1]!*x+seat.inward[2]*z;
    const radius=Math.hypot(wx,Math.max(0,Math.abs(wz)-layout.straightLength/2));
    expect(radius).toBeGreaterThan(.74);expect(radius).toBeLessThan(1.44);
   }
  }
 }
});
test('quality options are finite, supported and do not reset a shot or reservations',()=>{
 expect(validateQuality(undefined)).toEqual(DEFAULT_QUALITY);
 for(const invalid of [{ao:'ssgi'},{sssr:true},{shadowLights:99},{aoRadius:NaN},{reflectionOpacity:2},{effectsScale:0}])expect(()=>validateQuality(invalid)).toThrow('STUDIO_QUALITY_INVALID');
 const engine=new AppEngine({source:'demo',serverEpoch:'quality'});engine.apply(snapshot(6,0));engine.tick(2000);const before=engine.snapshot();
 engine.setStudioScene({...before.studio,quality:validateQuality({ao:'gtao',reflections:true})},before.revision,2100);
 expect(engine.snapshot().camera).toEqual(before.camera);expect(engine.snapshot().session).toEqual(before.session);
});
