import { expect, test } from 'bun:test';
import { newSession, SeatAllocator, validateSession } from '../../src/domain/seat-allocator.ts';
const UTC = '2026-11-06T00:00:00Z';
function create() { return new SeatAllocator(newSession('200', 'test')); }
test('A/B/C -> B leaves -> D joins -> B returns keeps reservations and never shrinks', () => {
  const seats = create(); seats.updatePresent(['3','1','2'], UTC);
  const before = seats.snapshot();
  expect(before.reservations.map(r => r.userId)).toEqual(['1','2','3']);
  seats.updatePresent(['1','3'], UTC);
  expect(seats.snapshot().reservations).toEqual(before.reservations);
  seats.updatePresent(['1','3','4'], UTC);
  seats.updatePresent(['1','2','3','4'], UTC);
  expect(seats.snapshot().reservations.slice(0, 3)).toEqual(before.reservations);
  expect(seats.snapshot().capacity).toBe(4);
});
test('unique reservations may exceed peak simultaneous occupancy', () => {
  const seats = create();
  for (let i = 1; i <= 6; i++) seats.updatePresent([String(i)], UTC);
  expect(seats.snapshot().peakPresentCount).toBe(1);
  expect(seats.snapshot().capacity).toBe(6);
  seats.updatePresent([], UTC);
  expect(seats.snapshot().capacity).toBe(6);
});
test('capacity 32 queues new users without stealing reserved seats', () => {
  const seats = create(); const ids = Array.from({ length: 34 }, (_, i) => String(i + 1));
  seats.updatePresent(ids, UTC);
  expect(seats.snapshot().capacity).toBe(32);
  expect(seats.snapshot().waitingUserIds).toEqual(['33','34']);
  seats.updatePresent(ids.filter(id => id !== '2'), UTC); seats.release('2');
  seats.updatePresent(ids.filter(id => id !== '2'), UTC);
  expect(seats.snapshot().reservations.find(r => r.userId === '33')?.slotIndex).toBe(1);
  expect(seats.snapshot().waitingUserIds).toEqual(['34']);
});
test('restart preserves seat IDs and returned snapshots cannot mutate the store', () => {
  const seats = create(); seats.updatePresent(['1','2'], UTC);
  const restored = new SeatAllocator(seats.snapshot());
  restored.updatePresent(['2','1'], UTC);
  expect(restored.snapshot()).toEqual(seats.snapshot());
  const copy = restored.snapshot(); copy.reservations.length = 0;
  expect(restored.snapshot().reservations).toHaveLength(2);
  expect(() => restored.release('1')).toThrow('CANNOT_RELEASE_PRESENT_USER');
});
test('corrupt and future session files are rejected', () => {
  const seats = create(); seats.updatePresent(['1','2'], UTC);
  const s = seats.snapshot(); s.reservations[1]!.slotIndex = 0;
  expect(() => validateSession(s)).toThrow('DUPLICATE_RESERVATION');
  expect(() => validateSession({ ...s, schemaVersion: 2 })).toThrow('INVALID_SESSION');
});
