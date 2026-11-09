import type {SeatTransform,Vec3} from '../contracts/domain.ts';
/** Shared dimensions for drawing, framing and footprint tests, in metres. */
export const NAMEPLATE={inset:1.03,width:.76,height:.205,baseDepth:.22,topDepth:.065,baseY:.764} as const;
export const MICROPHONE={x:-.46,z:-.055,baseRadius:.055} as const;
export function platePosition(seat:SeatTransform):Vec3{
 return [seat.position[0]+seat.inward[0]*NAMEPLATE.inset,NAMEPLATE.baseY,seat.position[2]+seat.inward[2]*NAMEPLATE.inset];
}
export function plateFramePoints(seat:SeatTransform):Vec3[]{
 const p=platePosition(seat),right=[Math.cos(seat.baseYawRad),0,-Math.sin(seat.baseYawRad)];
 const points:Vec3[]=[];
 for(const x of [-NAMEPLATE.width/2,0,NAMEPLATE.width/2])for(const y of [.01,NAMEPLATE.height])for(const z of [-NAMEPLATE.baseDepth/2,NAMEPLATE.baseDepth/2]){
  points.push([p[0]+right[0]!*x+seat.inward[0]*z,p[1]+y,p[2]+right[2]!*x+seat.inward[2]*z]);
 }
 return points;
}
