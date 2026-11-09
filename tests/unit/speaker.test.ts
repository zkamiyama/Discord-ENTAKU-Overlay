import { expect, test } from 'bun:test';
import { SpeakerTracker } from '../../src/domain/speaker-tracker.ts';
test('qualifies at 1000ms of active speech, not before', () => {
  const t = new SpeakerTracker(); t.update('1','active',0);
  expect(t.stats('1',999).qualified).toBe(false);
  expect(t.stats('1',1000).qualified).toBe(true);
});
test('duplicate START does not reset duration; STOP is idempotent', () => {
  const t = new SpeakerTracker(); t.update('1','active',0); t.update('1','active',700);
  expect(t.stats('1',1000).activeMs).toBe(1000);
  t.update('1','inactive',1100); t.update('1','inactive',1200);
  expect(t.stats('1',1300).activeMs).toBe(1100);
  expect(t.stats('1',1300).qualified).toBe(false);
});
test('brief silence connects an episode but adds no active time', () => {
  const t = new SpeakerTracker(); t.update('1','active',0); t.update('1','inactive',600); t.update('1','active',800);
  expect(t.stats('1',1000).qualified).toBe(false);
  expect(t.stats('1',1200).qualified).toBe(true);
  expect(t.stats('1',1200).activeMs).toBe(1000);
});
test('repeated separated backchannels do not accumulate into a qualified turn', () => {
  const t = new SpeakerTracker();
  for (let i = 0; i < 10; i++) { t.update('1','active',i*500); t.update('1','inactive',i*500+100); }
  t.update('1','active',5000);
  expect(t.stats('1',5100).qualified).toBe(false);
});
test('long speech has no fabricated TTL stop and disconnect becomes unknown', () => {
  const t = new SpeakerTracker(); t.update('1','active',0);
  expect(t.stats('1',130000).qualified).toBe(true);
  expect(t.stats('1',130000).recentMs).toBe(3000);
  t.update('1','unknown',130100);
  expect(t.stats('1',130200).state).toBe('unknown');
});
test('clock regressions are not silently converted into speech', () => {
  const t = new SpeakerTracker(); t.update('1','active',10);
  expect(() => t.stats('1',9)).toThrow('NON_MONOTONIC_TIME');
});


test('ten-second speech integration clips both interval ends and counts overlaps per person',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);t.update('2','active',1000);
 t.update('1','inactive',3000);t.update('1','active',4000);t.update('2','inactive',6000);t.update('1','inactive',8000);
 expect(t.stats('1',10000).windowMs).toBe(7000);expect(t.stats('2',10000).windowMs).toBe(5000);
 expect(t.stats('1',12000).windowMs).toBe(5000);expect(t.stats('2',12000).windowMs).toBe(4000);
 expect(t.stats('1',18000).windowMs).toBe(0);t.update('1','active',19000);expect(t.stats('1',100000).windowMs).toBe(10000);
 t.update('1','unknown',100001);expect(t.stats('1',100001).windowMs).toBe(0);
});
