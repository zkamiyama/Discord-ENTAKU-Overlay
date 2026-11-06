import {expect,test} from 'bun:test';
import {makeLayout,makeSessionLayout} from '../../src/geometry/capsule.ts';
import {newSession,SeatAllocator,validateSession} from '../../src/domain/seat-allocator.ts';
test('five people form two opposed pairs and a single rear moderator',()=>{
 const l=makeLayout(5);expect(l.straightLength).toBeGreaterThan(2);
 expect(l.seats.filter(s=>s.zone==='moderator')).toHaveLength(1);
 expect(l.seats.filter(s=>s.zone==='front')).toHaveLength(0);
 expect(l.seats[1]!.position[2]).toBe(l.seats[2]!.position[2]);
 expect(l.seats[3]!.position[2]).toBe(l.seats[4]!.position[2]);
 expect(l.seats[0]!.position[2]).toBeLessThan(-l.straightLength/2);
});
test('all capacities and one/two moderators respect caps, pairs and safe spacing',()=>{
 for(let n=1;n<=32;n++)for(const h of [1,2])for(const pitch of [1.1,2,3]){
  if(h>n)continue;const l=makeLayout(n,pitch,Array.from({length:h},(_,i)=>i));
  expect(l.seats.filter(s=>s.zone==='moderator')).toHaveLength(h);
  expect(l.seats.filter(s=>s.zone==='front')).toHaveLength((n-h)%2);
  expect(l.seats.filter(s=>s.zone==='left')).toHaveLength(Math.floor((n-h)/2));
  for(const s of l.seats){
   if(s.oppositeSlot!==undefined){const other=l.seats[s.oppositeSlot]!;expect(other.position[2]).toBe(s.position[2]);expect(other.inward[0]).toBe(-s.inward[0]);}
   for(const t of l.seats)if(t!==s)expect(Math.hypot(s.position[0]-t.position[0],s.position[2]-t.position[2])+1e-7).toBeGreaterThanOrEqual(pitch);
  }
 }
});
test('moderator changes keep logical seats, persistent IDs and the retained desk length',()=>{
 const a=new SeatAllocator(newSession('99','test',5));a.updatePresent(['1','2','3','4','5'],'2026-11-06T00:00:00Z');
 const before=a.snapshot();const l=makeSessionLayout(before);a.retainLength(l.straightLength);
 a.setModerators(['3','5']);const after=a.snapshot(),next=makeSessionLayout(after);
 expect(after.reservations).toEqual(before.reservations);expect(next.straightLength).toBeGreaterThanOrEqual(l.straightLength);
 expect(next.seats[2]!.zone).toBe('moderator');expect(next.seats[4]!.zone).toBe('moderator');
 expect(next.seats.filter(s=>s.zone==='front')).toHaveLength(1);
 a.updatePresent(['1','2','4','5'],'2026-11-06T00:00:01Z');expect(a.snapshot().moderatorIds).toEqual(['3','5']);
 expect(new SeatAllocator(JSON.parse(JSON.stringify(a.snapshot()))).snapshot()).toEqual(a.snapshot());
 expect(()=>a.setModerators(['1','2','3'])).toThrow('INVALID_MODERATORS');
 expect(()=>validateSession({...after,moderatorIds:['999']})).toThrow('INVALID_MODERATORS');
});
