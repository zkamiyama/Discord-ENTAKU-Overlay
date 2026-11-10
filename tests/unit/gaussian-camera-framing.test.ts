import {expect,test} from 'bun:test';
import {Group,PerspectiveCamera,Vector3} from 'three';
import {validateGaussianProfile,type GaussianAvatarManifest,type GaussianAvatarProfile,type GaussianBounds} from '../../src/assets/gaussian-profile.ts';
import type {CameraPlan,CameraPose,SeatTransform,Shot} from '../../src/contracts/domain.ts';
import {CameraContext} from '../../src/domain/camera-context.ts';
import {avatarOccluder} from '../../src/domain/camera-composition.ts';
import {planCamera} from '../../src/domain/camera-planner.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {makeSessionLayout} from '../../src/geometry/capsule.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {Avatar} from '../../src/web/overlay/avatar.ts';
import {gaussianFixture} from '../helpers/gaussian.ts';

const manifest=gaussianFixture().manifest;
const up=new Vector3(0,1,0);
const variants:{name:string;placement?:Partial<GaussianAvatarProfile>;geometry?:Partial<GaussianAvatarManifest>}[]=[
  {name:'canonical'},
  {name:'scaled with seat-local XYZ offsets and yaw',placement:{scale:1.25,offsetX:.18,offsetY:.2,offsetZ:.22,yawRad:.55}},
  {name:'enlarged face below the tabletop crop',placement:{scale:2,offsetY:-.5}},
  {name:'tall with an asymmetric face anchor',placement:{scale:1.15,offsetX:-.08,offsetY:.42,offsetZ:-.18,yawRad:-.4},geometry:{
    faceAnchor:[.04,1.4,.04],faceBounds:{min:[-.22,1.25,-.2],max:[.28,1.75,.23]},
    bodyBounds:{min:[-.38,0,-.25],max:[.38,2.1,.3]},framingBounds:{min:[-.38,.6,-.25],max:[.38,2.1,.3]},
  }},
  {name:'wide, rotated and cropped independently of the body',placement:{scale:1.1,offsetX:.1,offsetY:-.1,offsetZ:.17,yawRad:.6},geometry:{
    faceAnchor:[.08,1.32,-.03],faceBounds:{min:[-.38,1.1,-.25],max:[.46,1.65,.25]},
    bodyBounds:{min:[-.8,0,-.48],max:[.85,1.8,.48]},framingBounds:{min:[-.7,.65,-.43],max:[.78,1.8,.43]},
  }},
  // Legal 3D bounds cannot be replaced by the old image depth = width / 2.
  // Before the depth propagation fix, the front guest's face reaches NDC 1.077.
  {name:'face and framing deeper than their width',geometry:{
    faceAnchor:[0,1.4,0],faceBounds:{min:[-.22,1.1,-.6],max:[.22,1.7,.6]},
    bodyBounds:{min:[-.3,0,-.6],max:[.3,1.8,.6]},framingBounds:{min:[-.3,1,-.6],max:[.3,1.8,.6]},
  }},
];
function profile(userId:string,variant=variants[0]!):GaussianAvatarProfile{
  return validateGaussianProfile({kind:'gaussian',userId,assetId:'a'.repeat(64),scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0,...variant.placement,manifest:{...manifest,...variant.geometry}});
}
function setup(profiles:GaussianAvatarProfile[]){
  const engine=new AppEngine({source:'demo',serverEpoch:'gaussian-camera',avatarProfiles:profiles});
  for(const event of demoEvents())engine.apply(event);
  engine.tick(3000);
  const state=engine.snapshot(),layout=makeSessionLayout(state.session);
  const geometry=new CameraContext().geometry(()=>state.session,layout,new Map(state.participants.map(p=>[p.userId,p])),new Map(profiles.map(p=>[p.userId,p])));
  const rawSeats=new Map(state.session.reservations.map(r=>[r.userId,layout.seats[r.slotIndex]!]));
  const plan=(shot:Shot):CameraPlan=>planCamera(state.camera,shot,'GAUSSIAN_FRAMING_TEST',geometry.seats,layout.straightLength,4000,geometry.extents,layout.offsetZ??0);
  return {engine,state,layout,geometry,rawSeats,plan};
}
/** Independent oracle: project the actual normalized 3D box, not the planner's
 * surrogate extent or avatarFramePoints. The manifest bounds are canonical, so
 * source normalization must not be applied to them a second time. */
function worldCorners(p:GaussianAvatarProfile,seat:SeatTransform,box:GaussianBounds):Vector3[]{
  const anchor=new Vector3().fromArray(p.manifest.faceAnchor);
  const offset=new Vector3(p.offsetX,p.offsetY,p.offsetZ).applyAxisAngle(up,seat.baseYawRad);
  const origin=new Vector3().fromArray(seat.faceAnchor).add(offset),points:Vector3[]=[];
  for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){
    points.push(new Vector3(x,y,z).sub(anchor).multiplyScalar(p.scale).applyAxisAngle(up,p.yawRad+seat.baseYawRad).add(origin));
  }
  return points;
}
function projected(points:Vector3[],pose:CameraPose,aspect:number){
  const camera=new PerspectiveCamera(pose.fov,aspect,.15,1000);
  camera.position.fromArray(pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld(true);
  return points.map(p=>p.clone().project(camera));
}
function expectFaceInFrame(p:GaussianAvatarProfile,seat:SeatTransform,pose:CameraPose,aspect:number,margin:number,label:string){
  const corners=projected(worldCorners(p,seat,p.manifest.faceBounds),pose,aspect);
  for(const point of corners){
    expect(point.z,`${label}: face near clip`).toBeGreaterThanOrEqual(-1);
    expect(point.z,`${label}: face far clip`).toBeLessThan(1);
    expect(Math.abs(point.x),`${label}: face x`).toBeLessThanOrEqual(margin);
    expect(Math.abs(point.y),`${label}: face y`).toBeLessThanOrEqual(margin);
  }
}

for(const variant of variants)test(`A06 actual SINGLE, TWO_SHOT, WIDE and SPLIT project the Gaussian face: ${variant.name}`,()=>{
  const profiles=Array.from({length:6},(_,i)=>profile(String(100+i),variant)),scene=setup(profiles);
  const shots:Shot[]=[...profiles.map(p=>({kind:'SINGLE' as const,userIds:[p.userId] as [string]})),
    {kind:'TWO_SHOT',userIds:['101','103']},{kind:'WIDE',userIds:[]},{kind:'SPLIT',userIds:['101','104']}];
  for(const shot of shots){
    const plan=scene.plan(shot);
    // A wide fallback must not make a broken requested portrait look successful.
    expect(plan.shot.kind,`${variant.name}: requested ${shot.kind}`).toBe(shot.kind);
    const panels=plan.panels??[{pose:plan.to,userId:undefined}];
    if(shot.kind==='SPLIT')expect(panels).toHaveLength(2);
    for(const panel of panels){
      const ids=panel.userId?[panel.userId]:shot.kind==='WIDE'?profiles.map(p=>p.userId):shot.userIds;
      for(const id of ids)expectFaceInFrame(profiles.find(p=>p.userId===id)!,scene.rawSeats.get(id)!,panel.pose,plan.panels?8/9:16/9,shot.kind==='WIDE'?.90:.86,`${variant.name} ${shot.kind} ${id}`);
    }
  }
});

test('A06 body geometry grows real seat pitch and the occluder independently of a tighter framing crop',()=>{
  const scene=setup([profile('100')]),before=scene.state.session.reservations;
  const wide=profile('100',{name:'wide body, cropped face',placement:{offsetX:.1,offsetZ:.2,yawRad:Math.PI/4},geometry:{
    faceBounds:{min:[-.15,1.2,-.14],max:[.15,1.5,.14]},
    bodyBounds:{min:[-.86,0,-.7],max:[.86,1.9,.7]},
    framingBounds:{min:[-.21,1.05,-.17],max:[.21,1.55,.17]},
  }});
  scene.engine.setAvatarProfiles([wide],scene.state.revision,4000);
  const state=scene.engine.snapshot(),layout=makeSessionLayout(state.session),seat=layout.seats[state.session.reservations.find(r=>r.userId==='100')!.slotIndex]!;
  const body=worldCorners(wide,seat,wide.manifest.bodyBounds),origin=new Vector3().fromArray(seat.faceAnchor).add(new Vector3(wide.offsetX,wide.offsetY,wide.offsetZ).applyAxisAngle(up,seat.baseYawRad));
  const halfWidth=Math.max(...body.map(point=>Math.abs(point.clone().sub(origin).applyAxisAngle(up,-seat.baseYawRad).x)));
  expect(state.session.seatPitch).toBeCloseTo(2*(halfWidth+Math.abs(wide.offsetX))+.12,10);
  expect(state.session.seatPitch!).toBeGreaterThan(scene.state.session.seatPitch!);
  expect(state.session.reservations).toEqual(before);
  for(const a of layout.seats)for(const b of layout.seats)if(a.slotIndex<b.slotIndex)expect(new Vector3().fromArray(a.position).distanceTo(new Vector3().fromArray(b.position))+1e-7).toBeGreaterThanOrEqual(state.session.seatPitch!);
  const geometry=new CameraContext().geometry(()=>state.session,layout,new Map(state.participants.map(p=>[p.userId,p])),new Map([[wide.userId,wide]]));
  const extent=geometry.extents.get(wide.userId)!,box=avatarOccluder(geometry.seats.get(wide.userId)!,extent).expandByScalar(1e-10);
  expect(extent.bodyHalfWidth!).toBeGreaterThan(extent.halfWidth*2);
  // Lower-body points behind the tabletop are intentionally excluded by the
  // composition planner; all exposed body corners must remain blockers.
  const visibleBody=body.filter(point=>point.y>=.76);
  expect(visibleBody).toHaveLength(4);
  for(const point of visibleBody)expect(box.containsPoint(point)).toBe(true);
});

test('A06 camera-facing updates leave Gaussian seat yaw fixed across portrait and split camera positions',()=>{
  const p=profile('101',variants[1]),scene=setup([p]),seat=scene.rawSeats.get(p.userId)!;
  const avatar={root:new Group(),profile:p,baseYaw:seat.baseYawRad} as unknown as Avatar;
  const poses=[scene.plan({kind:'WIDE',userIds:[]}).to,scene.plan({kind:'SINGLE',userIds:[p.userId]}).to,
    ...scene.plan({kind:'SPLIT',userIds:['101','104']}).panels!.map(panel=>panel.pose)];
  for(const pose of poses){Avatar.prototype.faceCamera.call(avatar,new Vector3().fromArray(pose.position));expect(avatar.root.rotation.y).toBe(seat.baseYawRad);}
  // Guard that this is the production branch decision, not a test which keeps
  // every avatar fixed and accidentally disables the legacy image behavior.
  const image={root:new Group(),profile:undefined,baseYaw:seat.baseYawRad} as unknown as Avatar;
  Avatar.prototype.faceCamera.call(image,new Vector3(10,2,10));expect(image.root.rotation.y).not.toBe(seat.baseYawRad);
});
