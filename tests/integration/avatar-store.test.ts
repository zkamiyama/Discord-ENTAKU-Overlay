import { expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AvatarStore } from '../../src/assets/store.ts';
import { png } from '../helpers/png.ts';
test('custom assets roundtrip with content IDs and profiles persist without mutating on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'entaku-avatars-'));
  try {
    const store = new AvatarStore(dir); expect(await store.initialize()).toEqual([]);
    const image = await store.importImage(png());
    expect(await store.importImage(png())).toEqual(image);
    expect((await store.get(image.assetId)).bytes).toEqual(png());
    await expect(store.get('../../avatars.json')).rejects.toThrow('ASSET_NOT_FOUND');
    const profile = await store.validateDraft({ userId: '1', assetId: image.assetId, faceRect: [.25, .1, .5, .25], scale: 1, offsetX: 0, offsetY: 0, image: { width: 999, height: 999 } });
    expect(profile.image.width).toBe(64);
    await store.saveProfiles([profile]);
    expect(await new AvatarStore(dir).initialize()).toEqual([profile]);
    await mkdir(join(dir, 'avatars.json.bak'));
    await expect(store.saveProfiles([])).rejects.toThrow('AVATAR_SETTINGS_WRITE_FAILED');
    expect(store.snapshot()).toEqual([profile]);
    expect(JSON.parse(await readFile(join(dir, 'avatars.json'), 'utf8')).profiles).toEqual([profile]);
    await rm(join(dir, 'avatars.json.bak'), { recursive: true });
    await store.saveProfiles([]); expect(await new AvatarStore(dir).initialize()).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
