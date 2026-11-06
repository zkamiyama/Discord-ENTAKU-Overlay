import type { SeatTransform } from '../contracts/domain.ts';
import { TABLE } from '../domain/defaults.ts';
export interface RailPoint { x: number; z: number; inwardX: number; inwardZ: number }
function radiusAndLength(radius: number, length: number): void {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(length) || length < 0) throw new RangeError('INVALID_CAPSULE');
}
export function perimeter(radius: number, length: number): number { radiusAndLength(radius, length); return 2 * Math.PI * radius + 2 * length; }
export function pointAtDistance(radius: number, length: number, distance: number): RailPoint {
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
export function makeLayout(count: number, pitch:number=TABLE.seatPitch): { straightLength: number; seats: SeatTransform[] } {
  const radius = TABLE.innerRadius + TABLE.ringWidth + TABLE.avatarOffset;
  const straightLength = solveStraightLength(count, radius, pitch, TABLE.phase);
  return { straightLength, seats: railPoints(count, radius, straightLength, TABLE.phase).map((p, slotIndex) => ({
    slotIndex, position: [p.x, 0, p.z], inward: [p.inwardX, 0, p.inwardZ],
    baseYawRad: Math.atan2(p.inwardX, p.inwardZ), faceAnchor: [p.x, 1.25, p.z],
  })) };
}
