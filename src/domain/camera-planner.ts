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
export interface AvatarExtent { halfWidth: number; topY: number; bottomY: number }
export function widePose(straightLength: number, extents: Iterable<AvatarExtent> = []): CameraPose {
  // Fit sampled default-avatar bounds in camera space, not an oversized bounding sphere.
  const elevation=radians(38),sin=Math.sin(elevation),cos=Math.cos(elevation);
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
  if (length(inward)<0.5 || length(sub(a.faceAnchor,b.faceAnchor))>2.5) return null;
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
export function shotPose(shot: Shot, byUser: ReadonlyMap<string,SeatTransform>, straightLength:number, extents: ReadonlyMap<string,AvatarExtent> = new Map()): CameraPose {
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
export function samplePlan(plan:CameraPlan,now:number):CameraPose {
  if(plan.durationMs===0||now>=plan.startMs+plan.durationMs)return plan.to;
  if(now<=plan.startMs)return plan.from;
  const t=Math.max(0,Math.min(1,(now-plan.startMs)/plan.durationMs)),s=t*t*t*(t*(t*6-15)+10);
  return {position:lerp(plan.from.position,plan.to.position,s),target:lerp(plan.from.target,plan.to.target,s),fov:plan.from.fov+(plan.to.fov-plan.from.fov)*s};
}
/** Plan in table-local coordinates; protectStudioCamera applies the imported studio constraints. */
export function planCamera(previous:CameraPlan,shot:Shot,reason:string,byUser:ReadonlyMap<string,SeatTransform>,capacity:number,straightLength:number,now:number,extents:ReadonlyMap<string,AvatarExtent>=new Map()):CameraPlan {
  const from=samplePlan(previous,now),to=shotPose(shot,byUser,straightLength,extents);
  let durationMs=0;
  const cameraAngle = Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(from.target,from.position)),unit(sub(to.target,to.position))))));
  const travel = length(sub(from.position,to.position));
  if(previous.shot.kind==='SINGLE'&&shot.kind==='SINGLE') {
    const a=byUser.get(previous.shot.userIds[0]),b=byUser.get(shot.userIds[0]);
    if(a&&b) {
      const diff=Math.abs(a.slotIndex-b.slotIndex),adjacent=Math.min(diff,capacity-diff)<=1;
      let safe=adjacent&&cameraAngle<=radians(55)&&travel<=2.5;
      for(let i=0;safe&&i<=12;i++) {
        const p=lerp(from.position,to.position,i/12);
        safe=p[1]>TABLE.topY+0.12&&front(a,p)&&front(b,p);
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
      cameraAngle<=radians(65);
    for(let i=0;safe&&i<=16;i++) {
      const p=lerp(from.position,to.position,i/16);
      safe=p[1]>TABLE.topY+0.12&&front(a!,p)&&front(b!,p);
    }
    // Wider custom avatars need a longer dolly-out rather than a sudden CUT.
    if(safe)durationMs=widening
      ?Math.min(1600,Math.max(1200,Math.round(850+travel*150)))
      :Math.min(1400,Math.max(950,Math.round(750+travel*120)));
  }
  return {id:previous.id+1,shot,reason,transition:durationMs?'MOVE':'CUT',from,to,startMs:now,durationMs};
}
