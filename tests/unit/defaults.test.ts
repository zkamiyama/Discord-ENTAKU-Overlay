import {directionTiming} from '../../src/studio/direction.ts';
import { expect, test } from 'bun:test';
import { APP, DIRECTOR, TABLE } from '../../src/domain/defaults.ts';
test('approved defaults retain units, capacity, hysteresis and loopback binding', () => {
  expect(TABLE.minSeats).toBe(4);
  expect(TABLE.maxSeats).toBe(32);
  expect(TABLE.topY - TABLE.thickness).toBeGreaterThan(0.12);
  expect(directionTiming().qualifyMs).toBe(1000);
  expect(DIRECTOR.gapToleranceMs).toBe(250);
  expect(APP.host).toBe('127.0.0.1');
});
