import { expect,test } from 'bun:test';
import { validateProfile,requiredAvatarPitch,avatarFramingBounds } from '../../src/assets/avatar-profile.ts';
import { AppEngine } from '../../src/domain/engine.ts';
import { demoEvents } from '../../src/replay/demo.ts';
import { makeLayout } from '../../src/geometry/capsule.ts';
const p={userId:'1001',assetId:'a'.repeat(64),image:{width:256,height:256,mime:'image/png' as const},faceRect:[.25,.1,.5,.25] as const,scale:1.8,offsetX:0,offsetY:0};
test('back images align by their own face and framing rectangle must retain the face',()=>{
 const value=validateProfile({...p,back:{assetId:'b'.repeat(64),image:p.image,faceRect:[.2,.05,.4,.3]}});
 expect(value.back?.faceRect).toEqual([.2,.05,.4,.3]);expect(requiredAvatarPitch(value)).toBeGreaterThan(2);
 expect(()=>validateProfile({...p,framingRect:[0,.8,1,.2]})).toThrow('FRAMING_MUST_INCLUDE_FACE');
 expect(avatarFramingBounds(validateProfile({...p,framingRect:[.2,.05,.6,.5]})).bottom).toBeGreaterThan(avatarFramingBounds(validateProfile(p)).bottom);
});
test('wide images expand rail pitch, retain reservations on reset and persist pitch per session',()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'test'});for(const e of demoEvents())engine.apply(e);
 const id=engine.snapshot().participants[0]!.userId,before=engine.snapshot().session.reservations;
 engine.setAvatarProfiles([validateProfile({...p,userId:id})],0,2000);
 const wide=engine.snapshot();expect(wide.session.seatPitch).toBeGreaterThan(2);expect(wide.session.reservations).toEqual(before);
 engine.setAvatarProfiles([],1,2500);expect(engine.snapshot().session.seatPitch).toBe(wide.session.seatPitch);
 const restored=new AppEngine({source:'demo',serverEpoch:'restart',sessions:engine.sessions()});for(const e of demoEvents())restored.apply(e);
 expect(restored.snapshot().session.seatPitch).toBe(wide.session.seatPitch);
 for(let n=4;n<=32;n++){const layout=makeLayout(n,wide.session.seatPitch);for(let i=0;i<n;i++){const a=layout.seats[i]!.position,b=layout.seats[(i+1)%n]!.position;expect(Math.hypot(a[0]-b[0],a[2]-b[2])+1e-7).toBeGreaterThanOrEqual(wide.session.seatPitch!);}}
});
