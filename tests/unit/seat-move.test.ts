import {expect,test} from 'bun:test';
import {Box2,Vector2} from 'three';
import {SeatAllocator,newSession,validateSession} from '../../src/domain/seat-allocator.ts';
import {makeLayout,makeSessionLayout} from '../../src/geometry/capsule.ts';
import {plateFramePoints,NAMEPLATE} from '../../src/geometry/desk-props.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {dockPeople} from '../../src/web/dock/people.ts';
const utc='2026-11-09T00:00:00Z';
test('move swaps physical seats and moderator roles without reflow; empty host slot persists',()=>{
 const a=new SeatAllocator(newSession('1','test',6));a.updatePresent(['1','2','3','4','5'],utc);a.setModerators(['1','2']);
 const before=makeSessionLayout(a.snapshot());a.move('1',4);
 expect(a.snapshot().moderatorIds).toEqual(['5','2']);expect(makeSessionLayout(a.snapshot())).toEqual(before);
 a.move('2',5);expect(a.snapshot().moderatorSlots).toEqual([0,1]);expect(a.snapshot().moderatorIds).toEqual(['5']);expect(makeSessionLayout(a.snapshot())).toEqual(before);
 a.updatePresent(['1','2','3','4','5','6'],utc);expect(a.snapshot().moderatorIds).toEqual(['5','6']);
 expect(validateSession(a.snapshot())).toEqual(a.snapshot());
 const revision=a.snapshot().revision;expect(()=>a.move('1',99)).toThrow('INVALID_SEAT_TARGET');expect(a.snapshot().revision).toBe(revision);
});
test('released absent participants leave the Dock, keep profiles, and may join again',()=>{
 const e=new AppEngine({source:'demo',serverEpoch:'test'});for(const v of demoEvents())e.apply(v);e.tick(3000);
 const id=e.snapshot().participants[1]!.userId;
 e.apply({type:'participant-left',userId:id,sourceGeneration:1,receivedAtMs:3100});expect(dockPeople(e.snapshot()).some(p=>p.userId===id)).toBe(true);
 e.control({type:'release',userId:id},e.snapshot().revision,3200);expect(dockPeople(e.snapshot()).some(p=>p.userId===id)).toBe(false);
 const person=e.snapshot().participants.find(p=>p.userId===id)!;e.apply({type:'participant-upsert',participant:person,sourceGeneration:1,receivedAtMs:3300});e.tick(4000);
 expect(dockPeople(e.snapshot()).find(p=>p.userId===id)?.presence).toBe('present');
});
test('cohost plate footprints never overlap at the inner rim, from 2 to 32 seats',()=>{
 expect(NAMEPLATE.inset).toBe(1.03);
 for(let n=2;n<=32;n++)for(const pitch of [1.1,1.5,2.8]){
  const {seats}=makeLayout(n,pitch,[0,1]);const boxes=seats.slice(0,2).map(s=>new Box2().setFromPoints(plateFramePoints(s).map(p=>new Vector2(p[0],p[2]))).expandByScalar(.02));
  expect(boxes[0]!.intersectsBox(boxes[1]!)).toBe(false);
 }
});
