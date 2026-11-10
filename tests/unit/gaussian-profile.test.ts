import {expect,test} from 'bun:test';
import {validateProfile,avatarEnvelopeBounds,avatarFramingBounds,requiredAvatarPitch,isGaussianProfile} from '../../src/assets/avatar-profile.ts';
import {validateGaussianManifest,validateGaussianSettings,gaussianFaceSize,safeGaussianPath} from '../../src/assets/gaussian-profile.ts';
import {CameraContext} from '../../src/domain/camera-context.ts';
import {gaussianFixture} from '../helpers/gaussian.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {makeSessionLayout} from '../../src/geometry/capsule.ts';
const manifest=gaussianFixture().manifest;
const profile=()=>validateProfile({kind:'gaussian',userId:'1',assetId:'a'.repeat(64),manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0});
test('Gaussian geometry uses real face anchor, rotated 3D body and crop without image fields',()=>{
  const p=profile();expect(isGaussianProfile(p)).toBe(true);expect(p).not.toHaveProperty('faceRect');expect(p).not.toHaveProperty('image');
  const body=avatarEnvelopeBounds(p);expect(body.top).toBeCloseTo(.30);expect(body.bottom).toBeCloseTo(-1.41);expect(requiredAvatarPitch(p)).toBeCloseTo(.88);
  const rotated=validateProfile({...p,yawRad:Math.PI/2});expect(avatarEnvelopeBounds(rotated).right).toBeCloseTo(.29);expect(requiredAvatarPitch(rotated)).toBeCloseTo(.70);
  const crop=validateProfile({...p,manifest:{...manifest,framingBounds:{min:[-.31,1.05,-.30],max:[.31,1.65,.30]}}});expect(avatarFramingBounds(crop).bottom).toBeCloseTo(-.30);expect(avatarEnvelopeBounds(crop).bottom).toBeCloseTo(-1.41);
  if(!isGaussianProfile(p))throw new Error();expect(gaussianFaceSize(p)).toEqual({halfWidth:.30,halfHeight:expect.closeTo(.30,7)});
});
test('invalid canonical geometry, source axes, nonuniform scale and identities are rejected',()=>{
  expect(()=>validateGaussianManifest({...manifest,userId:'123'})).toThrow('GAUSSIAN_MANIFEST_INVALID');
  expect(()=>validateGaussianManifest({...manifest,coordinates:{units:'m',up:'+Y',forward:'-Y'}})).toThrow('GAUSSIAN_COORDINATES_INVALID');
  expect(()=>validateGaussianManifest({...manifest,normalization:{...manifest.normalization,scale:[1,2,1]}})).toThrow('GAUSSIAN_TRANSFORM_INVALID');
  expect(()=>validateGaussianManifest({...manifest,normalization:{...manifest.normalization,rotation:[NaN,0,0]}})).toThrow('GAUSSIAN_TRANSFORM_INVALID');
  expect(()=>validateGaussianManifest({...manifest,bodyBounds:{min:[0,0,0],max:[0,1,1]}})).toThrow('GAUSSIAN_BOUNDS_INVALID');
  expect(()=>validateGaussianManifest({...manifest,faceAnchor:[20,0,0]})).toThrow('GAUSSIAN_FACE_OUTSIDE_BOUNDS');
  expect(()=>validateGaussianManifest({...manifest,framingBounds:{min:[-1,0,-1],max:[1,.9,1]}})).toThrow('GAUSSIAN_FACE_OUTSIDE_BOUNDS');
  expect(()=>validateProfile({...profile(),scale:Infinity})).toThrow('GAUSSIAN_TRANSFORM_INVALID');
  expect(()=>validateProfile({...profile(),kind:'vrm'})).toThrow('INVALID_AVATAR_PROFILE');
});
test('placement roundtrips without a user identity and budget is one finite integer',()=>{
  const placement={scale:.8,offsetX:.1,offsetY:-.1,offsetZ:.2,yawRad:.5};
  expect(validateGaussianManifest({...manifest,placement}).placement).toEqual(placement);
  expect(validateGaussianSettings()).toEqual({lodSplatCount:500000});
  for(const n of [999,8_000_001,NaN,Infinity,1000.5])expect(()=>validateGaussianSettings({lodSplatCount:n})).toThrow();
});
test('bundle paths reject traversal, URI references, control characters and ambiguous encodings',()=>{
  for(const path of ['../avatar.ply','/avatar.ply','C:\\avatar.ply','x//a.ply','x/./a.ply','https://evil/avatar.ply','x/%2e%2e/a.ply','x\0.ply','x/a.ply?x','x/a.ply '])expect(()=>safeGaussianPath(path)).toThrow('GAUSSIAN_PATH_REJECTED');
  expect(safeGaussianPath('character/avatar.ply')).toBe('character/avatar.ply');
});
test('camera context applies seat-local offsets and uses Gaussian face dimensions for all shot planners',()=>{
  const engine=new AppEngine({source:'demo',serverEpoch:'test'});for(const e of demoEvents())engine.apply(e);const state=engine.snapshot();
  const participant=state.participants.find(p=>p.presence==='present')!,id=participant.userId,p=validateProfile({...profile(),userId:id,offsetX:.1,offsetY:.2,offsetZ:.25});
  const layout=makeSessionLayout(state.session),context=new CameraContext();
  const geometry=context.geometry(()=>state.session,layout,new Map(state.participants.map(p=>[p.userId,p])),new Map([[id,p]]));
  const reservation=state.session.reservations.find(r=>r.userId===id)!,seat=layout.seats[reservation.slotIndex]!,actual=geometry.seats.get(id)!;
  expect(actual.faceAnchor[0]).toBeCloseTo(seat.faceAnchor[0]+Math.cos(seat.baseYawRad)*.1+Math.sin(seat.baseYawRad)*.25);
  expect(actual.faceAnchor[1]).toBeCloseTo(seat.faceAnchor[1]+.2);
  expect(geometry.extents.get(id)?.faceHalfWidth).toBeCloseTo(.30);expect(geometry.extents.get(id)?.faceHalfHeight).toBeCloseTo(.30);
});
