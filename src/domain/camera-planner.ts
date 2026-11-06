import {QuadraticBezierCurve3,Vector3,MathUtils} from 'three';
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
export function widePose(straightLength: number, extents: Iterable<AvatarExtent> = []): CameraPose {
  // Fit sampled default-avatar bounds in camera space, not an oversized bounding sphere.
  const elevation=radians(24),sin=Math.sin(elevation),cos=Math.cos(elevation);
  const tanV=Math.tan(radians(22.5)),tanH=tanV*16/9,usable=.86;
  const railRadius=TABLE.innerRadius+TABLE.ringWidth+TABLE.avatarOffset;
  let side=.35, top=1.6, bottom=0;
  for(const e of extents){side=Math.max(side,e.halfWidth);top=Math.max(top,e.topY);bottom=Math.min(bottom,e.bottomY);}
  const total=perimeter(railRadius,straightLength);let distance=3;
  for(let i=0;i<72;i++) {
    const p=pointAtDistance(railRadius,straightLength,total*i/72);
    for(const dx of [-side,side])for(const dz of [-side,side])for(const y of [bottom-.8,top-.8]) {
      const x=p.x+dx,z=p.z+dz,nearOffset=y*sin+z*cos,vertical=y*cos-z*sin;
      distance=Math.max(distance,nearOffset+Math.max(Math.abs(x)/(tanH*usable),Math.abs(vertical)/(tanV*usable)));
    }
  }
  return {position:[0,.8+sin*distance,cos*distance],target:[0,.8,0],fov:45};
}
export function pairPose(a: SeatTransform,b: SeatTransform, extents: readonly AvatarExtent[] = []): CameraPose | null {
  const target=mul(add(a.faceAnchor,b.faceAnchor),0.5), inward=unit(add(a.inward,b.inward));
  const opposing=dot(a.inward,b.inward)<-.65&&Math.abs(a.position[2]-b.position[2])<.75;
  if(opposing){
    const width=length(sub(a.faceAnchor,b.faceAnchor))/2+Math.max(.65,...extents.map(e=>e.halfWidth));
    return {position:[target[0],Math.max(2.15,...extents.map(e=>e.topY+.2)),target[2]+width/Math.tan(radians(32))*1.1],target:add(target,[0,-.1,0]),fov:45};
  }
  if (length(inward)<0.5 || length(sub(a.faceAnchor,b.faceAnchor))>((a.zone==='moderator'||b.zone==='moderator')?4.6:3.5)) return null;
  const padding=Math.max(.65,...extents.map(e=>Math.hypot(e.halfWidth,Math.max(Math.abs(e.topY-target[1]),Math.abs(Math.max(e.bottomY,TABLE.topY)-target[1])))));
  const distance=(length(sub(a.faceAnchor,b.faceAnchor))/2+padding)/Math.sin(radians(20));
  const position=add(add(target,mul(inward,distance)),[0,0.25,0]);
  return front(a,position)&&front(b,position)?{position,target,fov:40}:null;
}
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function fitsCameraFrame(pose:CameraPose,points:readonly Vec3[],margin=.86):boolean{
  const forward=unit(sub(pose.target,pose.position)),right=unit(cross(forward,[0,1,0])),up=unit(cross(right,forward));
  const tanV=Math.tan(radians(pose.fov/2)),tanH=tanV*16/9;
  return points.every(point=>{const p=sub(point,pose.position),z=dot(p,forward);return z>.05&&Math.abs(dot(p,right))<=z*tanH*margin&&Math.abs(dot(p,up))<=z*tanV*margin;});
}
export function avatarFramePoints(seat:SeatTransform,extent:AvatarExtent):Vec3[]{
  const right:Vec3=[seat.inward[2],0,-seat.inward[0]],points:Vec3[]=[];
  for(const x of [-extent.halfWidth,extent.halfWidth])for(const y of [Math.max(TABLE.topY+.05,extent.bottomY),extent.topY])for(const z of [-extent.halfWidth*.5,extent.halfWidth*.5]){
    const p=add(add(seat.faceAnchor,mul(right,x)),mul(seat.inward,z));points.push([p[0],y,p[2]]);
  }
  const plate=add(seat.position,mul(seat.inward,.66));
  for(const x of [-.32,.32])for(const y of [.77,.93])for(const z of [-.02,.02]){const p=add(add(plate,mul(right,x)),mul(seat.inward,z));points.push([p[0],y,p[2]]);}
  return points;
}
function cleanShotPose(shot: Shot, byUser: ReadonlyMap<string,SeatTransform>, straightLength:number, extents: ReadonlyMap<string,AvatarExtent> = new Map()): CameraPose {
  if(shot.kind==='WIDE') return widePose(straightLength,extents.values());
  const a=byUser.get(shot.userIds[0]); if(!a) return widePose(straightLength,extents.values());
  if(shot.kind==='TWO_SHOT') {const b=byUser.get(shot.userIds[1]);return b?pairPose(a,b,shot.userIds.flatMap(id=>extents.has(id)?[extents.get(id)!]:[]))??widePose(straightLength,extents.values()):widePose(straightLength,extents.values());}
  const extent=extents.get(shot.userIds[0]);
  if(extent){
    const bottom=Math.max(TABLE.topY+.05,extent.bottomY),top=Math.max(bottom+.28,extent.topY);
    const target:Vec3=[a.faceAnchor[0],(top+bottom)/2,a.faceAnchor[2]];
    const points=avatarFramePoints(a,extent);
    for(let distance=2.15;distance<30;distance+=.1){
      const pose={position:add(add(target,mul(a.inward,distance)),[0,.18,0]),target,fov:35};
      if(fitsCameraFrame(pose,points))return pose;
    }
    return widePose(straightLength,extents.values());
  }
  return {position:add(add(a.faceAnchor,mul(a.inward,2.15)),[0,0.18,0]),target:add(a.faceAnchor,[0,-.12,0]),fov:35};
}
export function shotPose(shot:Shot,byUser:ReadonlyMap<string,SeatTransform>,straightLength:number,extents:ReadonlyMap<string,AvatarExtent>=new Map()):CameraPose {
 return chooseComposition(shot,byUser,extents,cleanShotPose(shot,byUser,straightLength,extents)).pose;
}
export function samplePlan(plan:CameraPlan,now:number):CameraPose {
  if(plan.durationMs===0||now>=plan.startMs+plan.durationMs)return plan.to;
  if(now<=plan.startMs)return plan.from;
  const t=MathUtils.clamp((now-plan.startMs)/plan.durationMs,0,1),s=MathUtils.smootherstep(t,0,1);
  const position=plan.via?new QuadraticBezierCurve3(new Vector3().fromArray(plan.from.position),new Vector3().fromArray(plan.via),new Vector3().fromArray(plan.to.position)).getPoint(s).toArray() as [number,number,number]:lerp(plan.from.position,plan.to.position,s);
  return {position,target:lerp(plan.from.target,plan.to.target,s),fov:plan.from.fov+(plan.to.fov-plan.from.fov)*s};
}
/** Plan in table-local coordinates; protectStudioCamera applies the imported studio constraints. */
export function planCamera(previous:CameraPlan,shot:Shot,reason:string,byUser:ReadonlyMap<string,SeatTransform>,capacity:number,straightLength:number,now:number,extents:ReadonlyMap<string,AvatarExtent>=new Map()):CameraPlan {
  const selected=chooseComposition(shot,byUser,extents,cleanShotPose(shot,byUser,straightLength,extents));
  if(selected.visibilityReason==='NO_CLEAR_COMPOSITION'){
    const from=samplePlan(previous,now),to=widePose(straightLength,extents.values());
    return {id:previous.id+1,shot:{kind:'WIDE',userIds:[]},reason,transition:'CUT',from,to,startMs:now,durationMs:0,composition:'WIDE',visibilityReason:'NO_CLEAR_COMPOSITION'};
  }
  const from=samplePlan(previous,now),to=selected.pose;
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
        safe=p[1]>TABLE.topY+0.12&&subjectsVisible({position:p,target:lerp(from.target,to.target,i/12),fov:from.fov+(to.fov-from.fov)*i/12},previous.shot.userIds,byUser,extents);
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
    for(const lift of [0,.5,1,1.7]){
      if(!feasible)break;
      const mid=lerp(from.position,to.position,.5),control:Vec3=[mid[0],mid[1]+lift*2,mid[2]];
      const curve=new QuadraticBezierCurve3(new Vector3().fromArray(from.position),new Vector3().fromArray(control),new Vector3().fromArray(to.position));
      let clear=true;
      for(let i=0;clear&&i<=20;i++){
        const t=i/20,p=curve.getPoint(t).toArray() as [number,number,number];
        clear=p[1]>TABLE.topY+.12&&subjectsVisible({position:p,target:lerp(from.target,to.target,t),fov:from.fov+(to.fov-from.fov)*t},shared,byUser,extents);
      }
      if(clear){safe=true;if(lift)via=control;break;}
    }
    // Wider custom avatars need a longer dolly-out rather than a sudden CUT.
    if(safe)durationMs=widening
      ?Math.min(1600,Math.max(1200,Math.round(850+travel*150)))
      :Math.min(1400,Math.max(950,Math.round(750+travel*120)));
  }
  return {id:previous.id+1,shot,reason,transition:durationMs?'MOVE':'CUT',...(via?{via}:{}),from,to,startMs:now,durationMs,composition:selected.composition,foregroundUserId:selected.foregroundUserId,visibilityReason:selected.visibilityReason};
}
