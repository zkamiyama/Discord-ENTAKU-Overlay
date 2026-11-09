import {MathUtils,PerspectiveCamera} from 'three';
import type {AppSnapshot,SeatTransform,CameraPose} from '../../contracts/domain.ts';
import {avatarFramingBounds} from '../../assets/avatar-profile.ts';
import {samplePlan,widePose} from '../../domain/camera-planner.ts';
import {DEFAULT_DIRECTION} from '../../studio/direction.ts';
/** Pure frame sampling keeps network state immutable. Desk and seats use the
 * same easing/progress, including the fixed moderator end during growth. */
export function sampleStage(state:AppSnapshot|null,now:number){
 let length=state?.straightLength??0,offsetZ=state?.deskOffsetZ??0,progress=1;
 const motion=state?.layoutMotion;
 if(motion){
  progress=MathUtils.smootherstep(MathUtils.clamp((now-motion.startMs)/motion.durationMs,0,1),0,1);
  length=MathUtils.lerp(motion.fromStraightLength,length,progress);
  offsetZ=MathUtils.lerp(motion.fromDeskOffsetZ??0,offsetZ,progress);
 }
 return {length,offsetZ,progress};
}
export function sampleSeat(target:SeatTransform,old:SeatTransform|undefined,progress:number):SeatTransform {
 if(!old||progress>=1)return target;
 const position=target.position.map((x,i)=>MathUtils.lerp(old.position[i]!,x,progress)) as [number,number,number];
 const yaw=old.baseYawRad+Math.atan2(Math.sin(target.baseYawRad-old.baseYawRad),Math.cos(target.baseYawRad-old.baseYawRad))*progress;
 return {...target,position,faceAnchor:[position[0],1.25,position[2]],baseYawRad:yaw,inward:[Math.sin(yaw),0,Math.cos(yaw)]};
}
export function cameraPose(state:AppSnapshot|null,now:number,ready:boolean):CameraPose {
 if(state&&ready)return samplePlan(state.camera,now);
 return widePose(state?.straightLength??0,state?.avatarProfiles.map(p=>{
  const b=avatarFramingBounds(p);return {halfWidth:Math.max(-b.left,b.right)+Math.abs(p.offsetX),topY:1.25+p.offsetY+b.top,bottomY:Math.max(0,1.25+p.offsetY+b.bottom)};
 })??[],state?.deskOffsetZ??0,(state?.studio.direction??DEFAULT_DIRECTION).wideHeightRatio);
}
export function setLocalCamera(camera:PerspectiveCamera,pose:CameraPose,near:number):void {
 const changed=camera.near!==near||camera.fov!==pose.fov;
 camera.near=near;camera.fov=pose.fov;camera.position.fromArray(pose.position);camera.lookAt(...pose.target);
 if(changed)camera.updateProjectionMatrix();
}
