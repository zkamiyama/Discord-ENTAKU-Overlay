import { expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppEngine } from '../../src/domain/engine.ts';
import { SessionStore } from '../../src/domain/session-store.ts';
import { newSession } from '../../src/domain/seat-allocator.ts';
import { demoParticipant } from '../../src/replay/demo.ts';
import { startServer } from '../../src/server/app.ts';
import type { ProviderEvent } from '../../src/contracts/domain.ts';
const utc = '2026-11-06T00:00:00Z';
const snapshot = (ids: string[], channelId: string, at: number): ProviderEvent => ({
  type: 'snapshot', channel: { channelId, name: `room ${channelId}`, kind: 'guild-voice' },
  participants: ids.map(id => ({ ...demoParticipant(id), channelId })), sourceGeneration: 1, receivedAtMs: at,
});
const ready = (at: number): ProviderEvent => ({ type: 'connection', status: 'ready', sourceGeneration: 1, receivedAtMs: at });
test('100 leave/return cycles and a persisted restart retain seats independently per channel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'entaku-lifecycle-'));
  try {
    const store = new SessionStore(dir);
    let engine = new AppEngine({ source: 'replay', serverEpoch: 'a', utcNow: () => utc });
    const users = Array.from({ length: 16 }, (_, i) => String(i + 1));
    engine.apply(snapshot(users, '200', 0)); engine.apply(ready(0)); engine.tick(2000);
    const original = engine.snapshot(), assigned = original.session.reservations;
    for (let i = 0; i < 100; i++) {
      const id = users[i % users.length]!, time = 3000 + i * 2000;
      engine.apply({ type: 'participant-left', userId: id, sourceGeneration: 1, receivedAtMs: time });
      engine.tick(time + 600);
      expect(engine.snapshot().seats).toEqual(original.seats);
      expect(engine.snapshot().session.reservations).toEqual(assigned);
      engine.apply({ type: 'participant-upsert', participant: { ...demoParticipant(id), channelId: '200' }, sourceGeneration: 1, receivedAtMs: time + 700 });
      engine.tick(time + 1300);
      expect(engine.snapshot().session.reservations).toEqual(assigned);
      expect(engine.snapshot().session.capacity).toBe(16);
    }
    engine.apply(snapshot(['99'], '201', 205000));
    expect(engine.snapshot().session.capacity).toBe(4);
    engine.apply(snapshot(users, '200', 206000));
    expect(engine.snapshot().session.reservations).toEqual(assigned);
    engine.apply({ type: 'speaking', userId: '1', state: 'active', sourceGeneration: 1, receivedAtMs: 206001 });
    for (const session of engine.sessions()) await store.save(session);
    engine = new AppEngine({ source: 'replay', serverEpoch: 'b', sessions: await store.loadAll() });
    engine.apply(snapshot(users, '200', 0)); engine.apply(ready(0));
    expect(engine.snapshot().session.reservations).toEqual(assigned);
    expect(engine.snapshot().participants.every(p => p.speaking === 'unknown')).toBe(true);
    engine.apply(snapshot(['99'], '201', 1));
    expect(engine.snapshot().session.reservations[0]?.userId).toBe('99');
    expect(engine.snapshot().session.capacity).toBe(4);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
test('failed backup leaves the primary session intact and a later save recovers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'entaku-save-failure-'));
  try {
    const store = new SessionStore(dir), session = newSession('200', 'intact');
    await store.save(session);
    // A directory at the backup path fails deterministically on Windows and Linux.
    await mkdir(join(dir, '200.json.bak'));
    await expect(store.save({ ...session, revision: 1 })).rejects.toThrow();
    expect(JSON.parse(await readFile(join(dir, '200.json'), 'utf8')).revision).toBe(0);
    expect((await readdir(dir)).filter(p => p.endsWith('.tmp'))).toEqual([]);
    await rm(join(dir, '200.json.bak'), { recursive: true });
    await store.save({ ...session, revision: 1 });
    expect((await store.loadAll())[0]?.revision).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
test('a new demo guest does not reuse a restored reserved Discord ID', async () => {
  const engine = new AppEngine({ source: 'demo', serverEpoch: 'a' });
  engine.apply(snapshot(['1001'], '200', 0)); engine.apply(ready(0));
  const sessions = engine.sessions();
  const restored = new AppEngine({ source: 'demo', serverEpoch: 'b', sessions });
  restored.apply(snapshot([], '200', 0)); restored.apply(ready(0));
  const app = startServer({ engine: restored, assets: {}, port: 0, now: () => 100 });
  try {
    const origin = `http://127.0.0.1:${app.server.port}`;
    const response = await fetch(origin + '/api/commands', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'demo-add', requestId: 'new', expectedRevision: 0 }) });
    expect(response.status).toBe(200);
    restored.tick(700);
    expect(restored.snapshot().session.reservations.map(r => r.userId)).toEqual(['1001', '1002']);
    expect(restored.snapshot().participants[0]?.userId).toBe('1002');
  } finally { await app.stop(); }
});
