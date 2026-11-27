import {MISSKEY_CARD_LIMIT} from '../contracts/misskey.ts';
import {TABLE} from '../domain/defaults.ts';
import {perimeter,pointAtDistance} from './capsule.ts';

export const MISSKEY_CARD_WIDTH=1.8;
export const MISSKEY_CARD_HEIGHT=.9;
export const MISSKEY_CARD_RADIUS=TABLE.innerRadius+TABLE.ringWidth+TABLE.avatarOffset+1.65;
const columns=[0,5,2,7,4,9,1,6,3,8] as const;
const heights=[1.95,2.95,3.95] as const;
export interface MisskeyCardPosition {x:number;y:number;z:number;inwardX:number;inwardZ:number}

/** Ten equal arc-length positions per row. Opposite slots arrive in pairs, so
 * a partially filled field remains balanced. Layout growth uses the desk offset. */
export function misskeyCardPosition(slot:number,straightLength:number,offsetZ=0):MisskeyCardPosition {
  if(!Number.isInteger(slot)||slot<0||slot>=MISSKEY_CARD_LIMIT)throw new RangeError('MISSKEY_SLOT_INVALID');
  if(!Number.isFinite(straightLength)||straightLength<0||straightLength>100||!Number.isFinite(offsetZ)||Math.abs(offsetZ)>200)throw new RangeError('MISSKEY_LAYOUT_INVALID');
  const row=Math.floor(slot/10),column=columns[slot%10]!;
  const point=pointAtDistance(MISSKEY_CARD_RADIUS,straightLength,perimeter(MISSKEY_CARD_RADIUS,straightLength)*(column+.5+row/3)/10);
  return {...point,y:heights[row]!,z:point.z+offsetZ};
}

/** The camera must be inward of the card's tangent. Suppress the near-side
 * cards that would otherwise appear between the camera and the participants. */
export function misskeyCardFacing(position:MisskeyCardPosition,cameraX:number,cameraZ:number):number {
  const distance=(cameraX-position.x)*position.inwardX+(cameraZ-position.z)*position.inwardZ;
  if(!Number.isFinite(distance))return 0;
  const t=Math.max(0,Math.min(1,distance/.45));
  return t*t*(3-2*t);
}
