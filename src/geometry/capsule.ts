import type { SeatTransform, SeatSession } from '../contracts/domain.ts';
import { TABLE } from '../domain/defaults.ts';
export interface RailPoint { x: number; z: number; inwardX: number; inwardZ: number }
function radiusAndLength(radius: number, length: number): void {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(length) || length < 0) throw new RangeError('INVALID_CAPSULE');
}
export function perimeter(radius: number, length: number): number { radiusAndLength(radius, length); return 2 * Math.PI * radius + 2 * length; }
function horizontalPointAtDistance(radius: number, length: number, distance: number): RailPoint {
  const p = perimeter(radius, length);
  if (!Number.isFinite(distance)) throw new RangeError('INVALID_DISTANCE');
  let s = ((distance % p) + p) % p;
  const h = length / 2, arc = Math.PI * radius;
  if (s < length) return { x: -h + s, z: radius, inwardX: 0, inwardZ: -1 };
  s -= length;
  if (s < arc) { const a = Math.PI / 2 - s / radius; return { x: h + radius * Math.cos(a), z: radius * Math.sin(a), inwardX: -Math.cos(a), inwardZ: -Math.sin(a) }; }
  s -= arc;
  if (s < length) return { x: h - s, z: -radius, inwardX: 0, inwardZ: 1 };
  s -= length;
  const a = -Math.PI / 2 - s / radius;
  return { x: -h + radius * Math.cos(a), z: radius * Math.sin(a), inwardX: -Math.cos(a), inwardZ: -Math.sin(a) };
}
/** Rotate the capsule's long axis onto Z; -Z is the moderator end. */
export function pointAtDistance(radius:number,length:number,distance:number):RailPoint {
  const p=horizontalPointAtDistance(radius,length,distance);
  return {x:p.z,z:-p.x,inwardX:p.inwardZ,inwardZ:-p.inwardX||0};
}
export function railPoints(count: number, radius: number, length: number, phase = 0.5): RailPoint[] {
  if (!Number.isInteger(count) || count < 1 || count > 32 || !Number.isFinite(phase)) throw new RangeError('INVALID_SEAT_COUNT');
  const p = perimeter(radius, length);
  return Array.from({ length: count }, (_, i) => pointAtDistance(radius, length, p * (i + phase) / count));
}
export function solveStraightLength(count: number, radius: number, pitch: number, phase = 0.5): number {
  radiusAndLength(radius, 0);
  if (!Number.isFinite(pitch) || pitch <= 0 || pitch >= 2 * radius) throw new RangeError('INVALID_PITCH');
  railPoints(count, radius, 0, phase);
  if (count === 1) return 0;
  const nominal = Math.max(0, (count * pitch - 2 * Math.PI * radius) / 2), step = Math.min(0.01, pitch / 100);
  for (let k = 0; k <= 20000; k++) {
    const length = nominal + k * step, pts = railPoints(count, radius, length, phase);
    if (pts.every((a, i) => { const b = pts[(i + 1) % count]!; return Math.hypot(a.x - b.x, a.z - b.z) + 1e-9 >= pitch; })) return length;
  }
  throw new RangeError('NO_VALID_LAYOUT');
}
export interface DeskLayout { straightLength:number; seats:SeatTransform[] }
/** Role placement, not equal spacing around a perimeter. Slots retain logical identity. */
export function makeLayout(count:number,pitch:number=TABLE.seatPitch,moderatorSlots:readonly number[]=[0],floor=0):DeskLayout {
  if(!Number.isInteger(count)||count<1||count>32)throw new RangeError('INVALID_SEAT_COUNT');
  const radius=TABLE.innerRadius+TABLE.ringWidth+TABLE.avatarOffset;
  if(!Number.isFinite(pitch)||pitch<=0||pitch>3||!Number.isFinite(floor)||floor<0||floor>100)throw new RangeError('INVALID_PITCH');
  const hosts=[...new Set(moderatorSlots)].filter(i=>Number.isInteger(i)&&i>=0&&i<count);
  if(!hosts.length)hosts.push(0);
  if(hosts.length>2)throw new RangeError('INVALID_MODERATORS');
  const remaining=Array.from({length:count},(_,i)=>i).filter(i=>!hosts.includes(i));
  const pairs=Math.floor(remaining.length/2),overflow=remaining.length%2;
  // Even five people need two genuinely straight opposing rows.
  let length=Math.max(floor,pairs?pairs*pitch+.8:0);
  const build=(L:number):SeatTransform[]=>{
    const seats:SeatTransform[]=Array(count);
    const add=(slotIndex:number,x:number,z:number,ix:number,iz:number,zone:SeatTransform['zone'],extra:Partial<SeatTransform>={})=>{
      seats[slotIndex]={slotIndex,zone,position:[x,0,z],inward:[ix,0,iz],baseYawRad:Math.atan2(ix,iz),faceAnchor:[x,1.25,z],...extra};
    };
    const angle=Math.asin(Math.min(.9,Math.max(.34,pitch/(2*radius))));
    hosts.forEach((slot,i)=>{const a=hosts.length===1?0:(i===0?-angle:angle);add(slot,radius*Math.sin(a),-L/2-radius*Math.cos(a),-Math.sin(a),Math.cos(a),'moderator');});
    for(let row=0;row<pairs;row++){
      const z=(row-(pairs-1)/2)*pitch,left=remaining[2*row]!,right=remaining[2*row+1]!;
      add(left,-radius,z,1,0,'left',{row,oppositeSlot:right});
      add(right,radius,z,-1,0,'right',{row,oppositeSlot:left});
    }
    if(overflow)add(remaining.at(-1)!,0,L/2+radius,0,-1,'front');
    return seats;
  };
  for(let n=0;n<2000;n++,length+=.025){
    const seats=build(length);
    if(seats.every((a,i)=>seats.slice(i+1).every(b=>Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2])+1e-8>=pitch)))return {straightLength:length,seats};
  }
  throw new RangeError('NO_VALID_LAYOUT');
}
export function makeSessionLayout(session:SeatSession):DeskLayout {
  const slots=(session.moderatorIds??[]).flatMap(id=>{const r=session.reservations.find(r=>r.userId===id);return r?[r.slotIndex]:[];});
  return makeLayout(session.capacity,session.seatPitch,slots.length?slots:[0],session.straightLengthFloor??0);
}
