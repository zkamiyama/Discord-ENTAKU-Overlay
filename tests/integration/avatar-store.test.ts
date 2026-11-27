import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AvatarStore } from '../../src/assets/store.ts';
import { SettingsStore } from '../../src/storage/settings-store.ts';
import { png } from '../helpers/png.ts';
test('custom assets roundtrip with content IDs and profiles persist through the settings owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'entaku-avatars-'));
  try {
    const store = new AvatarStore(dir), settings = new SettingsStore(dir); await store.initialize(); await settings.initialize();
    const image = await store.importImage(png());
    expect(await store.importImage(png())).toEqual(image);
    expect((await store.get(image.assetId)).bytes).toEqual(png());
    await expect(store.get('../../avatars.json')).rejects.toThrow('ASSET_NOT_FOUND');
    const profile = await store.validateDraft({ userId: '1', assetId: image.assetId, faceRect: [.25, .1, .5, .25], scale: 1, offsetX: 0, offsetY: 0, image: { width: 999, height: 999 } });
    expect(profile.image.width).toBe(64);
    settings.commit({...settings.snapshot(),avatarProfiles:await store.validateProfiles([profile])});
    expect((await new SettingsStore(dir).initialize()).avatarProfiles).toEqual([profile]);
    const restored = new AvatarStore(dir); await restored.initialize();
    expect((await restored.get(image.assetId)).bytes).toEqual(png());
    settings.commit({...settings.snapshot(),avatarProfiles:[]});
    expect((await new SettingsStore(dir).initialize()).avatarProfiles).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
