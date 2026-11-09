import {DEFAULT_DIRECTION,type DirectionSettings} from '../studio/direction.ts';
import {plateFramePoints} from '../geometry/desk-props.ts';
import {QuadraticBezierCurve3,Vector3,MathUtils,PerspectiveCamera} from 'three';
import {chooseComposition,subjectsVisible} from './camera-composition.ts';
import type { CameraPlan, CameraPose, SeatTransform, Shot, Vec3 } from '../contracts/domain.ts';
import { TABLE } from './defaults.ts';
import { perimeter, pointAtDistance } from '../geometry/capsule.ts';
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul = (a: Vec3, n: number): Vec3 => [a[0]*n,a[1]*n,a[2]*n];
export const dot = (a: Vec3, b: Vec3): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const length = (a: Vec3): number => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => length(a) > 1e-9 ? mul(a,1/length(a)) : [0,0,0];
const lerp = (a: Vec3,b: Vec3,t:number): Vec3 => add(a,mul(sub(b,a),t));
const radians = (d:number):number => d*Math.PI/180;
const front = (seat: SeatTransform, camera: Vec3): boolean => {
  const direction = sub(camera,seat.faceAnchor);
  return dot(unit([direction[0],0,direction[2]]),seat.inward) >= Math.cos(radians(70));
};
export interface AvatarExtent { halfWidth:number;topY:number;bottomY:number;bodyHalfWidth?:number;bodyTopY?:number;bodyBottomY?:number;faceHalfWidth?:number;faceHalfHeight?:number }
export interface WideSubject {center:Vec3;width:number;height:number;points?:readonly Vec3[]}
/** All camera positions remain on the audience side of the moderator's rear arc. */
export function moderatorRearLimit(straightLength:number,offsetZ=0):number {
  return offsetZ-straightLength/2-(TABLE.innerRadius+TABLE.ringWidth);
}
export function widePose(straightLength:number,extents:Iterable<AvatarExtent>=[],offsetZ=0,heightRatio=DEFAULT_DIRECTION.wideHeightRatio,faces:readonly WideSubject[]=[],nearClip=DEFAULT_DIRECTION.nearClip):CameraPose {
  const railRadius=TABLE.innerRadius+TABLE.ringWidth+TABLE.avatarOffset;
  let side=.35,top=1.6,bottom=0;
  for(const e of extents){side=Math.max(side,e.halfWidth);top=Math.max(top,e.topY);bottom=Math.min(bottom,e.bottomY);}
  // Keep the former high-angle position only as the height reference; fit the
  // current subjects and tabletop instead of empty space around every seat.
  const angle=radians(24),sin=Math.sin(angle),cos=Math.cos(angle),tv=Math.tan(radians(22.5)),th=tv*16/9;
  let referenceDistance=3;const envelope:Vec3[]=[];
  const total=perimeter(railRadius,straightLength);
  for(let i=0;i<72;i++){
    const p=pointAtDistance(railRadius,straightLength,total*i/72);
    for(const dx of [-side,side])for(const dz of [-side,side])for(const y of [bottom-.8,top-.8]){
      referenceDistance=Math.max(referenceDistance,y*sin+(p.z+dz)*cos+Math.max(Math.abs(p.x+dx)/(th*.86),Math.abs(y*cos-(p.z+dz)*sin)/(tv*.86)));
      envelope.push([p.x+dx,Math.max(TABLE.topY,y+.8),p.z+dz+offsetZ]);
    }
  }
  const points:Vec3[]=faces.length?faces.flatMap(f=>f.points?[...f.points]:[-f.width,f.width].flatMap(x=>[-f.height,f.height].map(y=>[f.center[0]+x,f.center[1]+y,f.center[2]] as Vec3))):envelope;
  const rim=perimeter(1.44,straightLength);
  for(let i=0;i<48;i++){const p=pointAtDistance(1.44,straightLength,rim*i/48);points.push([p.x,.685,p.z+offsetZ]);}
  const desiredHeight=Math.max(TABLE.topY+.35,(.8+sin*referenceDistance)*heightRatio);
  const targetY=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
  const target:Vec3=[0,Math.max(.95,targetY),offsetZ];
  const nearestZ=Math.max(...points.map(p=>p[2]));
  let best:CameraPose|undefined,bestScore=Infinity;
  // No yaw candidates: the wide camera is always exactly on the moderator axis.
  // Only raise it when that is needed to reveal faces behind a front-row avatar.
  for(const lift of (faces.length?[0,.15,.3,.45,.6,.75]:[0])){
    const height=desiredHeight+lift;
    const pose=(z:number):CameraPose=>({position:[0,height,z],target,fov:45});
    let lo=nearestZ+nearClip+.1,hi=Math.max(lo+1,offsetZ+referenceDistance);
    for(let i=0;i<24&&!fitsCameraFrame(pose(hi),points,.90,nearClip);i++)hi=offsetZ+(hi-offsetZ)*1.3;
    for(let i=0;i<25;i++){const mid=(lo+hi)/2;if(fitsCameraFrame(pose(mid),points,.90,nearClip))hi=mid;else lo=mid;}
    const candidate=pose(hi+.025),camera=new PerspectiveCamera(45,16/9,nearClip,1000);
    camera.position.fromArray(candidate.position);camera.lookAt(...target);camera.updateMatrixWorld(true);
    const rects=faces.map(f=>{
      const projected:Vector3[]=[];
      for(const x of [-f.width,f.width])for(const y of [-f.height,f.height])for(const z of [-f.width*.5,f.width*.5])projected.push(new Vector3(f.center[0]+x,f.center[1]+y,f.center[2]+z).project(camera));
      return {left:Math.min(...projected.map(p=>p.x)),right:Math.max(...projected.map(p=>p.x)),bottom:Math.min(...projected.map(p=>p.y)),top:Math.max(...projected.map(p=>p.y))};
    });
    let overlap=0;
    for(let i=0;i<rects.length;i++)for(let j=0;j<i;j++){
      const a=rects[i]!,b=rects[j]!,area=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top,b.top)-Math.max(a.bottom,b.bottom));
      overlap+=area/Math.max(1e-8,Math.min((a.right-a.left)*(a.top-a.bottom),(b.right-b.left)*(b.top-b.bottom)));
    }
    const score=overlap*2+lift+(hi-nearestZ)*.01;
    if(score<bestScore){bestScore=score;best=candidate;}
  }
  return best!;
}
export function wideFaces(seats:ReadonlyMap<string,SeatTransform>,extents:ReadonlyMap<string,AvatarExtent>):WideSubject[]{
 return [...seats].map(([id,seat])=>{const e=extents.get(id);return {center:seat.faceAnchor,width:e?.faceHalfWidth??.28,height:e?.faceHalfHeight??.28,points:avatarFramePoints(seat,e??{halfWidth:.28,topY:1.53,bottomY:.97})};});
}
export function pairPose(a: SeatTransform,b: SeatTransform, extents: readonly AvatarExtent[] = [],portraitFov=DEFAULT_DIRECTION.portraitFov): CameraPose | null {
  const target=mul(add(a.faceAnchor,b.faceAnchor),0.5), inward=unit(add(a.inward,b.inward));
  const fov=Math.min(35,portraitFov+4),points=[...avatarFramePoints(a,extents[0]??{halfWidth:.28,topY:1.53,bottomY:.97}),...avatarFramePoints(b,extents[1]??extents[0]??{halfWidth:.28,topY:1.53,bottomY:.97})];
  const opposing=dot(a.inward,b.inward)<-.65&&Math.abs(a.position[2]-b.position[2])<.75;
  if(opposing){
    const width=length(sub(a.faceAnchor,b.faceAnchor))/2+Math.max(.65,...extents.map(e=>e.halfWidth));
    const y=Math.max(1.9,...extents.map(e=>e.topY+.15));
    for(let distance=Math.max(2,width/(Math.tan(radians(fov/2))*16/9));distance<100;distance+=.2){
      const pose:CameraPose={position:[target[0],y,target[2]+distance],target:add(target,[0,-.1,0]),fov};
      if(fitsCameraFrame(pose,points,.86))return pose;
    }
    return null;
  }
  if (length(inward)<0.5 || length(sub(a.faceAnchor,b.faceAnchor))>((a.zone==='moderator'||b.zone==='moderator')?4.6:3.5)) return null;
  const padding=Math.max(.65,...extents.map(e=>Math.hypot(e.halfWidth,Math.max(Math.abs(e.topY-target[1]),Math.abs(Math.max(e.bottomY,TABLE.topY)-target[1])))));
  const distance=(length(sub(a.faceAnchor,b.faceAnchor))/2+padding)/Math.sin(radians(fov/2));
  const position=add(add(target,mul(inward,distance)),[0,0.25,0]);
  return front(a,position)&&front(b,position)?{position,target,fov}:null;
}
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function fitsCameraFrame(pose:CameraPose,points:readonly Vec3[],margin=.86,near=DEFAULT_DIRECTION.nearClip):boolean{
  const camera=new PerspectiveCamera(pose.fov,16/9,near,1000);
  camera.position.fromArray(pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld(true);
  const point=new Vector3();
  return points.every(p=>{point.fromArray(p).project(camera);return point.z>=-1&&point.z<1&&Math.abs(point.x)<=margin&&Math.abs(point.y)<=margin;});
}
export function avatarFramePoints(seat:SeatTransform,extent:AvatarExtent):Vec3[]{
  const right:Vec3=[seat.inward[2],0,-seat.inward[0]],points:Vec3[]=[];
  for(const x of [-extent.halfWidth,extent.halfWidth])for(const y of [Math.max(TABLE.topY+.05,extent.bottomY),extent.topY])for(const z of [-extent.halfWidth*.5,extent.halfWidth*.5]){
    const p=add(add(seat.faceAnchor,mul(right,x)),mul(seat.inward,z));points.push([p[0],y,p[2]]);
  }
  points.push(...plateFramePoints(seat));
  return points;
}
function cleanShotPose(shot: Shot, byUser: ReadonlyMap<string,SeatTransform>, straightLength:number, extents: ReadonlyMap<string,AvatarExtent> = new Map(),offsetZ=0,settings:DirectionSettings=DEFAULT_DIRECTION): CameraPose {
  if(shot.kind==='WIDE') return widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip);
  const a=byUser.get(shot.userIds[0]); if(!a) return widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip);
  if(shot.kind==='TWO_SHOT') {const b=byUser.get(shot.userIds[1]);return b?pairPose(a,b,shot.userIds.flatMap(id=>extents.has(id)?[extents.get(id)!]:[]),settings.portraitFov)??widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip):widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip);}
  const extent=extents.get(shot.userIds[0])??{halfWidth:.28,topY:1.53,bottomY:.97};
  if(extent){
    const bottom=Math.max(TABLE.topY+.05,extent.bottomY),top=Math.max(bottom+.28,extent.topY);
    const target:Vec3=[a.faceAnchor[0],(top+bottom)/2,a.faceAnchor[2]];
    const points=avatarFramePoints(a,extent);
    for(let distance=2.15;distance<100;distance+=.1){
      const pose={position:add(add(target,mul(a.inward,distance)),[0,.18,0]),target,fov:settings.portraitFov};
      if(fitsCameraFrame(pose,points,.86,settings.nearClip))return pose;
    }
    return widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip);
  }
  return {position:add(add(a.faceAnchor,mul(a.inward,2.15)),[0,0.18,0]),target:add(a.faceAnchor,[0,-.12,0]),fov:settings.portraitFov};
}
export function shotPose(shot:Shot,byUser:ReadonlyMap<string,SeatTransform>,straightLength:number,extents:ReadonlyMap<string,AvatarExtent>=new Map(),offsetZ=0,settings:DirectionSettings=DEFAULT_DIRECTION):CameraPose {
 const selected=chooseComposition(shot,byUser,extents,cleanShotPose(shot,byUser,straightLength,extents,offsetZ,settings),settings.portraitFov,moderatorRearLimit(straightLength,offsetZ),settings.nearClip);
 return selected.visibilityReason==='NO_CLEAR_COMPOSITION'?widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip):selected.pose;
}
export function samplePlan(plan:CameraPlan,now:number):CameraPose {
  if(plan.durationMs===0||now>=plan.startMs+plan.durationMs)return plan.to;
  if(now<=plan.startMs)return plan.from;
  const t=MathUtils.clamp((now-plan.startMs)/plan.durationMs,0,1),s=MathUtils.smootherstep(t,0,1);
  const position=plan.via?new QuadraticBezierCurve3(new Vector3().fromArray(plan.from.position),new Vector3().fromArray(plan.via),new Vector3().fromArray(plan.to.position)).getPoint(s).toArray() as [number,number,number]:lerp(plan.from.position,plan.to.position,s);
  return {position,target:lerp(plan.from.target,plan.to.target,s),fov:plan.from.fov+(plan.to.fov-plan.from.fov)*s};
}
/** Plan in table-local coordinates; protectStudioCamera applies the imported studio constraints. */
export function planCamera(previous:CameraPlan,shot:Shot,reason:string,byUser:ReadonlyMap<string,SeatTransform>,capacity:number,straightLength:number,now:number,extents:ReadonlyMap<string,AvatarExtent>=new Map(),offsetZ=0,settings:DirectionSettings=DEFAULT_DIRECTION):CameraPlan {
  const selected=chooseComposition(shot,byUser,extents,cleanShotPose(shot,byUser,straightLength,extents,offsetZ,settings),settings.portraitFov,moderatorRearLimit(straightLength,offsetZ),settings.nearClip);
  if(selected.visibilityReason==='NO_CLEAR_COMPOSITION'){
    const from=samplePlan(previous,now),to=widePose(straightLength,extents.values(),offsetZ,settings.wideHeightRatio,wideFaces(byUser,extents),settings.nearClip);
    return {id:previous.id+1,shot:{kind:'WIDE',userIds:[]},reason,transition:'CUT',from,to,startMs:now,durationMs:0,composition:'WIDE',visibilityReason:'NO_CLEAR_COMPOSITION'};
  }
  const from=samplePlan(previous,now),to=selected.pose;
  const rear=moderatorRearLimit(straightLength,offsetZ);
  let durationMs=0,via:Vec3|undefined;
  const cameraAngle = Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(from.target,from.position)),unit(sub(to.target,to.position))))));
  const travel = length(sub(from.position,to.position));
  if(previous.shot.kind==='SINGLE'&&shot.kind==='SINGLE') {
    const a=byUser.get(previous.shot.userIds[0]),b=byUser.get(shot.userIds[0]);
    if(a&&b) {
      const adjacent=length(sub(a.faceAnchor,b.faceAnchor))<=Math.max(2.5,extents.get(previous.shot.userIds[0])?.halfWidth??0);
      let safe=adjacent&&cameraAngle<=radians(55)&&travel<=2.5;
      for(let i=0;safe&&i<=12;i++) {
        const p=lerp(from.position,to.position,i/12);
        safe=p[2]>=rear&&p[1]>TABLE.topY+0.12&&subjectsVisible({position:p,target:lerp(from.target,to.target,i/12),fov:from.fov+(to.fov-from.fov)*i/12},previous.shot.userIds,byUser,extents,settings.nearClip);
      }
      if(safe)durationMs=900;
    }
  }

  // Widen to include a second nearby speaker without an abrupt cut. The same
  // move works in reverse when the discussion returns to one of the pair.
  // Distant pairs, unrelated speaker changes and obstructed paths stay CUTs.
  const widening=previous.shot.kind==='SINGLE'&&shot.kind==='TWO_SHOT'&&shot.userIds.includes(previous.shot.userIds[0]);
  const narrowing=previous.shot.kind==='TWO_SHOT'&&shot.kind==='SINGLE'&&previous.shot.userIds.includes(shot.userIds[0]);
  if(widening||narrowing) {
    const pair=widening?shot as Extract<Shot,{kind:'TWO_SHOT'}>:previous.shot as Extract<Shot,{kind:'TWO_SHOT'}>;
    const a=byUser.get(pair.userIds[0]),b=byUser.get(pair.userIds[1]);
    // pairPose is also the feasibility test used by ShotDirector.
    let safe=!!a&&!!b&&!!pairPose(a,b,pair.userIds.flatMap(id=>extents.has(id)?[extents.get(id)!]:[]))&&
      cameraAngle<=radians(110);
    const feasible=safe;safe=false;
    const shared=previous.shot.userIds.filter(id=>shot.userIds.includes(id));
    const sharedTarget=byUser.get(shared[0]??'')?.faceAnchor??to.target;
    search:for(const back of [0,1.5,3,6])for(const lift of [0,.5,1,1.7,3]){
      if(!feasible)break search;
      const mid=lerp(from.position,to.position,.5),out=unit(sub(mid,sharedTarget));
      const control:Vec3=[mid[0]+out[0]*back,mid[1]+lift*2,mid[2]+out[2]*back];
      if(control[2]<rear||from.position[2]<rear)continue;
      const curve=new QuadraticBezierCurve3(new Vector3().fromArray(from.position),new Vector3().fromArray(control),new Vector3().fromArray(to.position));
      let clear=true;
      for(let i=0;clear&&i<=20;i++){
        const t=i/20,p=curve.getPoint(t).toArray() as [number,number,number];
        clear=p[2]>=rear&&p[1]>TABLE.topY+.12&&subjectsVisible({position:p,target:lerp(from.target,to.target,t),fov:from.fov+(to.fov-from.fov)*t},shared,byUser,extents,settings.nearClip);
      }
      if(clear){safe=true;if(lift||back)via=control;break search;}
    }
    // Wider custom avatars need a longer dolly-out rather than a sudden CUT.
    if(safe)durationMs=widening
      ?Math.min(1600,Math.max(1200,Math.round(850+travel*150)))
      :Math.min(1400,Math.max(950,Math.round(750+travel*120)));
  }
  return {id:previous.id+1,shot,reason,transition:durationMs?'MOVE':'CUT',...(via?{via}:{}),from,to,startMs:now,durationMs,composition:selected.composition,foregroundUserId:selected.foregroundUserId,visibilityReason:selected.visibilityReason};
}
