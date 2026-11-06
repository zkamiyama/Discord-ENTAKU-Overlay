import { Box3, Matrix4, Ray, Vector3 } from 'three';
import type { CameraPlan, CameraPose, Vec3 } from '../contracts/domain.ts';
import type { StudioScene } from './manifest.ts';
const vec=(v:Vec3)=>new Vector3().fromArray(v);
function segmentHit(a:Vec3,b:Vec3,box:Box3):boolean{
  const from=vec(a),to=vec(b),direction=to.clone().sub(from),distance=direction.length();
  if(box.containsPoint(from)||box.containsPoint(to))return true;
  if(distance<1e-8)return false;
  const hit=new Ray(from,direction.divideScalar(distance)).intersectBox(box,new Vector3());
  return !!hit&&hit.distanceTo(from)<=distance;
}
/** No mesh decoder or intersection implementation: Three.js math handles conservative proxies. */
export function protectStudioCamera(plan:CameraPlan,scene:StudioScene,defaultWide:CameraPose,wideFits:(pose:CameraPose)=>boolean=()=>true):CameraPlan{
  const inverse=new Matrix4().makeRotationY(scene.tableAnchor.yawDeg*Math.PI/180).setPosition(...scene.tableAnchor.position).invert();
  const boxes=(scene.camera?.blockers??[]).map(b=>new Box3(vec(b.min),vec(b.max)).applyMatrix4(inverse));
  if(!boxes.length)return plan;
  const clear=(pose:CameraPose)=>boxes.every(box=>!box.clone().expandByScalar(.12).containsPoint(vec(pose.position))&&!segmentHit(pose.position,pose.target,box));
  if(clear(plan.to)){
    if(plan.transition==='MOVE'){
      let safe=boxes.every(box=>!segmentHit(plan.from.position,plan.to.position,box.clone().expandByScalar(.12)));
      for(let i=0;safe&&i<=12;i++){
        const t=i/12,position=vec(plan.from.position).lerp(vec(plan.to.position),t).toArray() as [number,number,number],target=vec(plan.from.target).lerp(vec(plan.to.target),t).toArray() as [number,number,number];
        safe=clear({position,target,fov:plan.to.fov});
      }
      if(!safe)return {...plan,transition:'CUT',durationMs:0,safetyReason:'STUDIO_PATH_BLOCKED'};
    }
    return plan;
  }
  // Blockers are world-space; all camera poses, including safeWide, are table-local.
  // The overlay applies tableAnchor once when rendering the camera.
  const custom=scene.camera?.safeWide?structuredClone(scene.camera.safeWide):null;
  const pose=custom&&clear(custom)&&wideFits(custom)?custom:defaultWide;
  return {...plan,shot:{kind:'WIDE',userIds:[]},to:pose,transition:'CUT',durationMs:0,studioHidden:!clear(pose),safetyReason:clear(pose)?'STUDIO_SHOT_BLOCKED':'STUDIO_HIDDEN_FOR_CAMERA'};
}
