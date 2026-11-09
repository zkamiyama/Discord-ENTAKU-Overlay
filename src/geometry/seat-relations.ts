import type {SeatTransform} from '../contracts/domain.ts';
/** Co-hosts or immediate neighbours on one straight rail share one camera. */
export function adjacentSeats(a:SeatTransform,b:SeatTransform):boolean {
 if(a.slotIndex===b.slotIndex)return false;
 if(a.zone==='moderator'&&b.zone==='moderator')return true;
 return (a.zone==='left'||a.zone==='right')&&a.zone===b.zone&&a.row!==undefined&&b.row!==undefined&&Math.abs(a.row-b.row)===1;
}
