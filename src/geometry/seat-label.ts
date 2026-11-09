import type {SeatTransform} from '../contracts/domain.ts';
export function seatLabel(seat:SeatTransform,all:readonly SeatTransform[]):string {
 if(seat.zone==='moderator')return all.filter(s=>s.zone==='moderator').length===1?'司会':seat.position[0]<0?'司会左':'司会右';
 if(seat.zone==='left'||seat.zone==='right')return `${seat.zone==='left'?'左':'右'}${(seat.row??0)+1}`;
 return seat.zone==='front'?'手前':`席${seat.slotIndex+1}`;
}
