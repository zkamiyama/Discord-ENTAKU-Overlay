import type { CameraPlan, CameraPose, SeatTransform, Shot, Vec3 } from '../contracts/domain.ts';
import { TABLE } from './defaults.ts';
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
export function widePose(straightLength: number): CameraPose {
  const radius=Math.hypot(straightLength/2+2.5,2.5,1.2), distance=radius/Math.sin(radians(22.5))*1.08;
  return {position:[0,0.8+Math.sin(radians(38))*distance,Math.cos(radians(38))*distance],target:[0,0.8,0],fov:45};
}
export function pairPose(a: SeatTransform,b: SeatTransform): CameraPose | null {
  const target=mul(add(a.faceAnchor,b.faceAnchor),0.5), inward=unit(add(a.inward,b.inward));
  if (length(inward)<0.5 || length(sub(a.faceAnchor,b.faceAnchor))>2.5) return null;
  const distance=(length(sub(a.faceAnchor,b.faceAnchor))/2+0.65)/Math.sin(radians(20));
  const position=add(add(target,mul(inward,distance)),[0,0.25,0]);
  return front(a,position)&&front(b,position)?{position,target,fov:40}:null;
}
export function shotPose(shot: Shot, byUser: ReadonlyMap<string,SeatTransform>, straightLength:number): CameraPose {
  if(shot.kind==='WIDE') return widePose(straightLength);
  const a=byUser.get(shot.userIds[0]); if(!a) return widePose(straightLength);
  if(shot.kind==='TWO_SHOT') {const b=byUser.get(shot.userIds[1]);return b?pairPose(a,b)??widePose(straightLength):widePose(straightLength);}
  return {position:add(add(a.faceAnchor,mul(a.inward,2.15)),[0,0.18,0]),target:a.faceAnchor,fov:35};
}
export function samplePlan(plan:CameraPlan,now:number):CameraPose {
  if(plan.durationMs===0)return plan.to;
  const t=Math.max(0,Math.min(1,(now-plan.startMs)/plan.durationMs)),s=t*t*t*(t*(t*6-15)+10);
  return {position:lerp(plan.from.position,plan.to.position,s),target:lerp(plan.from.target,plan.to.target,s),fov:plan.from.fov+(plan.to.fov-plan.from.fov)*s};
}
/** Default scene only. Imported studio blockers are a separate, not-yet-implemented milestone. */
export function planCamera(previous:CameraPlan,shot:Shot,reason:string,byUser:ReadonlyMap<string,SeatTransform>,capacity:number,straightLength:number,now:number):CameraPlan {
  const from=samplePlan(previous,now),to=shotPose(shot,byUser,straightLength);
  let move=false;
  if(previous.shot.kind==='SINGLE'&&shot.kind==='SINGLE') {
    const a=byUser.get(previous.shot.userIds[0]),b=byUser.get(shot.userIds[0]);
    if(a&&b) {
      const diff=Math.abs(a.slotIndex-b.slotIndex),adjacent=Math.min(diff,capacity-diff)<=1;
      const yaw=Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(from.target,from.position)),unit(sub(to.target,to.position))))));
      move=adjacent&&yaw<=radians(55)&&length(sub(from.position,to.position))<=2.5;
      for(let i=0;move&&i<=12;i++) {
        const p=lerp(from.position,to.position,i/12);
        move=p[1]>TABLE.topY+0.12&&front(a,p)&&front(b,p);
      }
    }
  }
  return {id:previous.id+1,shot,reason,transition:move?'MOVE':'CUT',from,to,startMs:now,durationMs:move?900:0};
}
