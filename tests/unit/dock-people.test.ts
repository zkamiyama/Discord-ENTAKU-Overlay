import { expect, test } from 'bun:test';
import { AppEngine } from '../../src/domain/engine.ts';
import { dockPeople } from '../../src/web/dock/people.ts';
import { newSession, SeatAllocator } from '../../src/domain/seat-allocator.ts';
import { demoParticipant } from '../../src/replay/demo.ts';
function restored() {
  const allocator = new SeatAllocator(newSession('200', 'restored'));
  allocator.updatePresent(['1', '2'], '2026-11-06T00:00:00Z');
  const engine = new AppEngine({ source: 'demo', serverEpoch: 'test', sessions: [allocator.snapshot()] });
  engine.apply({ type: 'snapshot', channel: { channelId: '200', name: 'test', kind: 'guild-voice' }, participants: [{ ...demoParticipant('1'), channelId: '200' }], sourceGeneration: 1, receivedAtMs: 0 });
  return engine;
}
test('restored reservations remain visible without inventing participant metadata', () => {
  const engine = restored();
  engine.apply({ type: 'connection', status: 'ready', sourceGeneration: 1, receivedAtMs: 1 });
  const people = dockPeople(engine.snapshot());
  expect(people.map(p => p.userId)).toEqual(['1', '2']);
  expect(people[1]?.name).toBe('ID 2（名前未取得）');
  expect(people[1]?.participant).toBeUndefined();
  expect(people[1]?.canRelease).toBe(true);
  expect(engine.snapshot().participants).toHaveLength(1);
  engine.control({ type: 'release', userId: '2' }, 0, 2);
  expect(dockPeople(engine.snapshot()).map(p => p.userId)).toEqual(['1']);
  expect(engine.snapshot().session.capacity).toBe(4);
});
test('unconfirmed membership never enables release, including while reconnecting', () => {
  const engine = restored();
  expect(dockPeople(engine.snapshot())[1]?.presence).toBe('unverified');
  expect(dockPeople(engine.snapshot())[1]?.canRelease).toBe(false);
  expect(() => engine.control({ type: 'release', userId: '2' }, 0, 1)).toThrow('MEMBERSHIP_UNCONFIRMED');
  engine.apply({ type: 'connection', status: 'ready', sourceGeneration: 1, receivedAtMs: 2 });
  engine.apply({ type: 'connection', status: 'disconnected', sourceGeneration: 1, receivedAtMs: 3 });
  expect(dockPeople(engine.snapshot()).every(p => !p.canRelease)).toBe(true);
  expect(() => engine.control({ type: 'release', userId: '1' }, 0, 4)).toThrow('MEMBERSHIP_UNCONFIRMED');
  expect(engine.snapshot().session.reservations).toHaveLength(2);
});
