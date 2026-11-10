import {DEFAULT_DIRECTION} from '../studio/direction.ts';
import {plateFramePoints} from '../geometry/desk-props.ts';
import {Box3,Matrix4,PerspectiveCamera,Ray,Vector3} from 'three';
import type {CameraPlan,CameraPose,SeatTransform,Shot,Vec3} from '../contracts/domain.ts';
import type {AvatarExtent} from './camera-planner.ts';
const v=(p:Vec3)=>new Vector3().fromArray(p);
const tuple=(p:Vector3)=>p.toArray() as [number,number,number];
export const DEFAULT_EXTENT:AvatarExtent={halfWidth:.28,topY:1.53,bottomY:.97};
/** Conservative envelope includes the rendered front/back image and its +/-30deg
 * yaw, or the actual transformed Gaussian body volume when depth is supplied.
 * Three.js Ray/Box3 handle intersection; transparent pixels are not read in the domain.
 */
export function avatarOccluder(seat:SeatTransform,extent:AvatarExtent):Box3 {
 const width=extent.bodyHalfWidth??extent.halfWidth;
 const top=extent.bodyTopY??extent.topY,bottom=Math.max(.76,extent.bodyBottomY??extent.bottomY);
 const box=new Box3(new Vector3(-width,bottom-seat.faceAnchor[1],(extent.bodyBack??-width*.5)-.035),new Vector3(width,Math.max(bottom+.02,top)-seat.faceAnchor[1],(extent.bodyFront??width*.5)+.035));
 return box.applyMatrix4(new Matrix4().makeRotationY(seat.baseYawRad).setPosition(...seat.faceAnchor));
}
function targets(seat:SeatTransform,extent:AvatarExtent):Vector3[]{
 const right=new Vector3(Math.cos(seat.baseYawRad),0,-Math.sin(seat.baseYawRad));
 const points:Vector3[]=[];
 const fw=extent.faceHalfWidth??.17,fh=extent.faceHalfHeight??.17;
 const faceDepth=extent.faceBack===undefined&&extent.faceFront===undefined?[0]:[extent.faceBack??0,extent.faceFront??0];
 for(const x of [-fw,0,fw])for(const y of [-fh,0,fh])for(const depth of faceDepth)points.push(v(seat.faceAnchor).addScaledVector(right,x).add(new Vector3(0,y,0)).addScaledVector(v(seat.inward),depth));
 // Preserve the configured framing rectangle, not just the face center.
 for(const x of [-extent.halfWidth,extent.halfWidth])for(const y of [Math.max(.80,extent.bottomY),extent.topY])for(const depth of [extent.back??-extent.halfWidth*.5,extent.front??extent.halfWidth*.5]){
  const p=v(seat.faceAnchor).addScaledVector(right,x).addScaledVector(v(seat.inward),depth);p.y=y;points.push(p);
 }
 // The nameplate is as important as the face and sits nearer the camera.
 points.push(...plateFramePoints(seat).map(v));
 return points;
}
export function subjectsVisible(pose:CameraPose,ids:readonly string[],seats:ReadonlyMap<string,SeatTransform>,extents:ReadonlyMap<string,AvatarExtent>,near=DEFAULT_DIRECTION.nearClip,aspect=16/9):boolean {
 const origin=v(pose.position),camera=new PerspectiveCamera(pose.fov,aspect,near,1000);
 camera.position.copy(origin);camera.lookAt(...pose.target);camera.updateMatrixWorld(true);
 const blockers=[...seats].filter(([id])=>!ids.includes(id)).map(([id,s])=>avatarOccluder(s,extents.get(id)??DEFAULT_EXTENT));
 if(blockers.some(box=>box.clone().expandByScalar(.08).containsPoint(origin)))return false;
 for(const id of ids){
  const seat=seats.get(id);if(!seat)return false;
  for(const point of targets(seat,extents.get(id)??DEFAULT_EXTENT)){
   const screen=point.clone().project(camera);if(screen.z< -1||screen.z>1||Math.abs(screen.x)>.86||Math.abs(screen.y)>.86)return false;
   const dir=point.clone().sub(origin),distance=dir.length(),ray=new Ray(origin,dir.normalize());
   if(blockers.some(box=>{const hit=ray.intersectBox(box,new Vector3());return hit!==null&&hit.distanceTo(origin)<distance-.025;}))return false;
  }
 }
 return true;
}
function foregroundArea(pose:CameraPose,seat:SeatTransform,extent:AvatarExtent,near=DEFAULT_DIRECTION.nearClip,aspect=16/9):number {
 const camera=new PerspectiveCamera(pose.fov,aspect,near,1000);camera.position.fromArray(pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld(true);
 const box=avatarOccluder(seat,extent),points:Vector3[]=[];
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new Vector3(x,y,z).project(camera));
 if(points.some(p=>p.z< -1||p.z>1))return 0;
 const left=Math.max(-1,Math.min(...points.map(p=>p.x))),right=Math.min(1,Math.max(...points.map(p=>p.x)));
 const bottom=Math.max(-1,Math.min(...points.map(p=>p.y))),top=Math.min(1,Math.max(...points.map(p=>p.y)));
 const tangent=new Vector3(Math.cos(seat.baseYawRad),0,-Math.sin(seat.baseYawRad));
 const w=Math.min(.20,extent.faceHalfWidth??.20),h=Math.min(.20,extent.faceHalfHeight??.20);
 const face=[v(seat.faceAnchor),v(seat.faceAnchor).addScaledVector(tangent,w),v(seat.faceAnchor).addScaledVector(tangent,-w),v(seat.faceAnchor).add(new Vector3(0,h,0)),v(seat.faceAnchor).add(new Vector3(0,-h,0))];
 if(!face.some(point=>{const p=point.project(camera);return p.z> -1&&p.z<1&&Math.abs(p.x)<.99&&Math.abs(p.y)<.99;}))return 0;
 return Math.max(0,right-left)*Math.max(0,top-bottom)/4;
}
export interface Composition {pose:CameraPose;composition:NonNullable<CameraPlan['composition']>;foregroundUserId?:string;visibilityReason?:string}
export function chooseComposition(shot:Shot,seats:ReadonlyMap<string,SeatTransform>,extents:ReadonlyMap<string,AvatarExtent>,clean:CameraPose,portraitFov=22,rearLimit=-Infinity,near=DEFAULT_DIRECTION.nearClip,aspect=16/9):Composition {
 if(shot.kind==='WIDE')return {pose:clean,composition:'WIDE'};
 const primary=seats.get(shot.userIds[0]);if(!primary)return {pose:clean,composition:'SINGLE_CLEAN',visibilityReason:'TARGET_UNAVAILABLE'};
 const host=primary.zone==='moderator';
 if(shot.kind==='SINGLE'){
  const foreground=[...seats].filter(([id,s])=>id!==shot.userIds[0]&&v(s.inward).dot(v(primary.inward))<-.15)
   .sort(([,a],[,b])=>Number(b.slotIndex===primary.oppositeSlot)-Number(a.slotIndex===primary.oppositeSlot)||v(a.faceAnchor).distanceTo(v(primary.faceAnchor))-v(b.faceAnchor).distanceTo(v(primary.faceAnchor))).slice(0,3);
  let best:{score:number;value:Composition}|undefined;
  for(const [id,seat] of foreground){
   const extent=extents.get(id)??DEFAULT_EXTENT,width=extent.bodyHalfWidth??extent.halfWidth,top=extent.bodyTopY??extent.topY;
   const right=new Vector3(Math.cos(seat.baseYawRad),0,-Math.sin(seat.baseYawRad));
   for(const back of [2,3.5,5,7,10])for(const side of [-1,1])for(const lateral of [Math.max(.55,width*.9),width+.55,width+1.05,width+1.65])for(const rise of [0,.3,.65,1.0]){
    const position=v(seat.faceAnchor).addScaledVector(v(seat.inward),-back).addScaledVector(right,side*lateral);
    position.y=Math.max(1.6,top-.08)+rise;
    if(position.z<rearLimit)continue;
    const target=v(primary.faceAnchor).add(new Vector3(0,-.08,0));
    const faceView=position.clone().sub(v(primary.faceAnchor)).setY(0).normalize().dot(v(primary.inward));
    if(faceView<.25)continue;
    let pose:CameraPose|undefined;
    for(const fov of [portraitFov,Math.min(35,portraitFov+4)]){const candidate={position:tuple(position),target:tuple(target),fov};const area=foregroundArea(candidate,seat,extent,near,aspect);if(area>=.01&&area<=.38&&subjectsVisible(candidate,shot.userIds,seats,extents,near,aspect)){pose=candidate;break;}}
    if(!pose)continue;
    const score=rise*3+lateral*.7+(seat.slotIndex===primary.oppositeSlot?0:1.3)+(pose.fov-portraitFov)*.25+back*.06;
    if(!best||score<best.score)best={score,value:{pose,composition:host?'MODERATOR_SINGLE':'SINGLE_OTS',foregroundUserId:id,visibilityReason:rise>0?'ELEVATED_TO_AVOID_OCCLUSION':lateral>width?'SHIFTED_TO_AVOID_OCCLUSION':'OVER_SHOULDER'}};
    if(score<1.5)return best.value;
   }
  }
  if(best)return best.value;
 }
 // Clean fallback is also checked. A tall foreground cannot cover the face
 // merely because the OTS candidate search was exhausted.
 const composition=shot.kind==='TWO_SHOT'?(shot.userIds.every(id=>seats.get(id)?.zone==='moderator')?'MODERATOR_TWO':'TWO_SHOT'):host?'MODERATOR_SINGLE':'SINGLE_CLEAN';
 const direction=v(clean.position).sub(v(clean.target));
 const opposing=shot.kind==='TWO_SHOT'&&v(primary.inward).dot(v(seats.get(shot.userIds[1])!.inward))<-.65;
 const sign=primary.position[0]<=0?1:-1;
 for(const angle of (opposing?[0,.22*sign,-.22*sign,.45*sign,-.45*sign]:[0,-.3,.3,-.6,.6,-.9,.9]))for(const scale of [1,1.35,1.8])for(const rise of [0,.35,.75,1.25,2,3.5,5]){
  const position=direction.clone().applyAxisAngle(new Vector3(0,1,0),angle).multiplyScalar(scale).add(v(clean.target));position.y+=rise;
  if(position.z<rearLimit)continue;
  const pose={...clean,position:tuple(position)};
  if(subjectsVisible(pose,shot.userIds,seats,extents,near,aspect))return {pose,composition,visibilityReason:rise?'ELEVATED_TO_AVOID_OCCLUSION':shot.kind==='SINGLE'?'FALLBACK_TO_CLEAN_SINGLE':undefined};
 }
 return {pose:clean,composition,visibilityReason:'NO_CLEAR_COMPOSITION'};
}
