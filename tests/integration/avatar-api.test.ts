import { expect, test } from 'bun:test';
import { AppEngine } from '../../src/domain/engine.ts';
import { startServer } from '../../src/server/app.ts';
import { AvatarStore } from '../../src/assets/store.ts';
import { demoEvents } from '../../src/replay/demo.ts';
import { png } from '../helpers/png.ts';
const keys = { read: '1'.repeat(64), control: '2'.repeat(64) };
function start(store = new AvatarStore()) {
  const engine = new AppEngine({ source: 'demo', serverEpoch: 'test' });
  for (const event of demoEvents()) engine.apply(event);
  const app = startServer({ engine, keys, avatarStore: store, assets: {}, port: 0, now: () => 100 });
  const origin = `http://127.0.0.1:${app.server.port}`;
  const command = (body: Record<string,unknown>) => fetch(origin + '/api/commands', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${keys.control}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { app, engine, origin, command };
}
test('asset API authenticates, keeps draft out of program, and serializes conflicting edits', async () => {
  const { app, engine, origin, command } = start();
  try {
    const cases: Record<string,string>[] = [{}, { Origin: origin, Authorization: `Bearer ${keys.read}` }, { Origin: 'http://attacker.invalid', Authorization: `Bearer ${keys.control}` }];
    for(const headers of cases){
      expect((await fetch(origin + '/api/assets', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: new Uint8Array(png()) })).status).toBe(403);
    }
    const imported = await fetch(origin + '/api/assets', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${keys.control}`, 'Content-Type': 'image/png' }, body: new Uint8Array(png()) });
    expect(imported.status).toBe(201);
    const asset = await imported.json();
    expect(engine.snapshot().avatarProfiles).toEqual([]);
    expect((await fetch(origin + '/api/assets/' + asset.assetId)).status).toBe(403);
    const image = await fetch(origin + '/api/assets/' + asset.assetId, { headers: { Authorization: `Bearer ${keys.read}` } });
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(png()));
    const profile = { userId: engine.snapshot().participants[0]!.userId, assetId: asset.assetId, faceRect: [.25, .1, .5, .25], scale: 1, offsetX: 0, offsetY: 0 };
    const first = { type: 'avatar-set', profile, expectedRevision: 0, requestId: 'first' };
    const replies = await Promise.all([command(first), command({ ...first, requestId: 'second' })]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    expect(engine.snapshot().revision).toBe(1);
    expect(engine.snapshot().avatarProfiles[0]?.image).toEqual({ width: 64, height: 128, mime: 'image/png' });
    expect((await command(first)).status).toBe(200); // Same request is idempotent even after revision advances.
    const rejected = await command({ ...first, profile: { ...profile, faceRect: [.9, 0, 1, 1] }, expectedRevision: 1, requestId: 'invalid' });
    expect((await rejected.json()).error).toBe('INVALID_FACE_RECT');
    expect(engine.snapshot().revision).toBe(1);
    expect((await command({ type: 'avatar-reset', userId: profile.userId, expectedRevision: 1, requestId: 'reset' })).status).toBe(200);
    expect(engine.snapshot().avatarProfiles).toEqual([]);
  } finally { await app.stop(); }
});
test('failed profile save cannot change program state or edit revision', async () => {
  class FailingStore extends AvatarStore { override async saveProfiles(): Promise<void> { throw new Error('AVATAR_SETTINGS_WRITE_FAILED'); } }
  const { app, engine, origin, command } = start(new FailingStore());
  try {
    const response = await fetch(origin + '/api/assets', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${keys.control}`, 'Content-Type': 'image/png' }, body: new Uint8Array(png()) });
    const { assetId } = await response.json();
    const result = await command({ type: 'avatar-set', profile: { userId: '1', assetId, faceRect: [.25, .1, .5, .25], scale: 1, offsetX: 0, offsetY: 0 }, expectedRevision: 0, requestId: 'save-fails' });
    expect(result.status).toBe(422); expect((await result.json()).error).toBe('AVATAR_SETTINGS_WRITE_FAILED');
    expect(engine.snapshot().revision).toBe(0); expect(engine.snapshot().avatarProfiles).toEqual([]);
  } finally { await app.stop(); }
});
