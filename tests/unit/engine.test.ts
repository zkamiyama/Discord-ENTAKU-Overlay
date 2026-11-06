import { expect, test } from 'bun:test';
import { AppEngine } from '../../src/domain/engine.ts';
import type { Participant, ProviderEvent } from '../../src/contracts/domain.ts';
const p = (userId: string): Participant => ({ userId, channelId: '200', username: userId, displayName: userId, presence: 'present', speaking: 'unknown', voice: { selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false } });
function setup() {
  const e = new AppEngine({ source: 'replay', serverEpoch: 'test', utcNow: () => '2026-11-06T00:00:00Z', sessionId: () => 'fixture' });
  e.apply({ type: 'connection', status: 'ready', sourceGeneration: 1, receivedAtMs: 0 });
  return e;
}
const snapshot = (ids: string[], at = 0): ProviderEvent => ({ type: 'snapshot', channel: { channelId: '200', name: 'test', kind: 'guild-voice' }, participants: ids.map(p), sourceGeneration: 1, receivedAtMs: at });
test('membership reconciliation preserves speech, old generations cannot resurrect it', () => {
  const e = setup(); e.apply(snapshot(['1']));
  e.apply({ type: 'speaking', userId: '1', state: 'active', sourceGeneration: 1, receivedAtMs: 100 });
  e.apply(snapshot(['1'], 600)); e.tick(1100);
  expect(e.snapshot().camera.shot).toEqual({ kind: 'SINGLE', userIds: ['1'] });
  e.apply({ type: 'connection', status: 'disconnected', sourceGeneration: 2, receivedAtMs: 1200 });
  expect(e.snapshot().participants[0]?.presence).toBe('stale');
  expect(e.snapshot().participants[0]?.speaking).toBe('unknown');
  expect(e.snapshot().camera.shot.kind).toBe('WIDE');
  expect(e.apply({ type: 'speaking', userId: '1', state: 'active', sourceGeneration: 1, receivedAtMs: 1300 })).toBe(false);
  expect(e.snapshot().participants[0]?.speaking).toBe('unknown');
});
test('unknown speaker does not allocate a seat; delayed metadata may resolve the state', () => {
  const e = setup(); e.apply(snapshot([]));
  e.apply({ type: 'speaking', userId: '9', state: 'active', sourceGeneration: 1, receivedAtMs: 100 });
  expect(e.snapshot().session.reservations).toHaveLength(0);
  e.apply(snapshot(['9'], 300));
  expect(e.snapshot().participants[0]?.speaking).toBe('active');
  e.tick(1000); expect(e.snapshot().camera.shot.kind).toBe('WIDE');
  e.tick(1300); expect(e.snapshot().camera.shot.kind).toBe('SINGLE');
});
test('source loss preserves seats, return restores identities, stale timestamps never rewind speech', () => {
  const e = setup(); e.apply(snapshot(['1','2','3','4','5'])); const seats = e.snapshot().session.reservations;
  e.tick(2000); e.apply({ type: 'speaking', userId: '1', state: 'active', sourceGeneration: 1, receivedAtMs: 1950 });
  e.tick(3000); expect(e.snapshot().camera.shot.kind).toBe('SINGLE');
  e.apply({ type: 'connection', status: 'disconnected', sourceGeneration: 1, receivedAtMs: 3100 });
  expect(e.snapshot().session.reservations).toEqual(seats);
  expect(e.snapshot().session.capacity).toBe(5);
});
test('Dock edits require revision and reject absent targets or releasing a present user', () => {
  const e=setup();e.apply(snapshot(['1']));
  expect(e.control({type:'mode',mode:'HOLD'},0,0)).toBe(1);
  expect(()=>e.control({type:'mode',mode:'AUTO'},0,0)).toThrow('REVISION_CONFLICT');
  expect(()=>e.control({type:'shot',shot:{kind:'SINGLE',userIds:['2']}},1,0)).toThrow('TARGET_NOT_PRESENT');
  expect(()=>e.control({type:'release',userId:'1'},1,0)).toThrow('CANNOT_RELEASE_PRESENT_USER');
});
test('a just-left guest can be released before the layout debounce expires', () => {
  const e=setup(); e.apply(snapshot(['1']));
  e.apply({type:'participant-left',userId:'1',sourceGeneration:1,receivedAtMs:100});
  expect(e.control({type:'release',userId:'1'},0,110)).toBe(1);
  expect(e.snapshot().session.reservations).toHaveLength(0);
});
test('a returning guest cannot lose the reserved seat inside the debounce window', () => {
  const e=setup(); e.apply(snapshot(['1']));
  e.apply({type:'participant-left',userId:'1',sourceGeneration:1,receivedAtMs:100}); e.tick(600);
  const oldSeat=e.snapshot().session.reservations[0]?.seatId;
  e.apply({type:'participant-upsert',participant:p('1'),sourceGeneration:1,receivedAtMs:700});
  expect(()=>e.control({type:'release',userId:'1'},0,710)).toThrow('CANNOT_RELEASE_PRESENT_USER');
  expect(e.snapshot().session.reservations[0]?.seatId).toBe(oldSeat);
});
test('manual shot requested during layout growth executes after the safety wide instead of being lost', () => {
  const e=setup();e.apply(snapshot(['1','2','3','4','5']));
  e.control({type:'shot',shot:{kind:'SINGLE',userIds:['1']}},0,100);
  expect(e.snapshot().camera.shot.kind).toBe('WIDE');
  e.tick(2000);expect(e.snapshot().camera.shot).toEqual({kind:'SINGLE',userIds:['1']});
  e.tick(10000);expect(e.snapshot().camera.shot).toEqual({kind:'SINGLE',userIds:['1']});
});
test('AUTO cancels a queued manual shot during layout growth', () => {
  const e=setup();e.apply(snapshot(['1','2','3','4','5']));
  e.control({type:'shot',shot:{kind:'SINGLE',userIds:['1']}},0,100);
  e.control({type:'mode',mode:'AUTO'},1,150);
  e.tick(2000);expect(e.snapshot().camera.shot.kind).toBe('WIDE');
});
