import {writeAtomicJson} from '../storage/atomic-json.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, lstat, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectImage, MAX_IMAGE_BYTES, type ImageInfo } from './image.ts';
import { validateProfile, type AvatarProfile } from './avatar-profile.ts';
export interface StoredImage extends ImageInfo { assetId: string; byteLength: number }
const validId = (id: string) => /^[a-f0-9]{64}$/.test(id);
async function readBounded(path: string, maximum: number): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maximum) throw new Error('ASSET_FILE_REJECTED');
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(Math.min(maximum + 1, stat.size + 1)); let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break; length += bytesRead;
    }
    if (length !== stat.size || length > maximum) throw new Error('ASSET_FILE_REJECTED');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
/** null directory is the safe-mode / test memory store, never a disk fallback. */
export class AvatarStore {
  private memory = new Map<string, Uint8Array>();
  private metadata = new Map<string, StoredImage>();
  private profiles: AvatarProfile[] = [];
  private imageBytes = 0;
  constructor(private directory: string | null = null) {}
  async initialize(): Promise<AvatarProfile[]> {
    if (!this.directory) return [];
    await mkdir(join(this.directory, 'assets', 'avatars'), { recursive: true, mode: 0o700 });
    try {
      const payload: unknown = JSON.parse((await readBounded(join(this.directory, 'avatars.json'), 2 * 1024 * 1024)).toString('utf8'));
      const value = payload as { schemaVersion?: number; profiles?: unknown[] };
      if (!value || value.schemaVersion !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 256) throw new Error();
      const profiles = value.profiles.map(validateProfile);
      if (new Set(profiles.map(p => p.userId)).size !== profiles.length) throw new Error();
      this.profiles = profiles;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('AVATAR_SETTINGS_READ_FAILED'); }
    return this.snapshot();
  }
  snapshot(): AvatarProfile[] { return structuredClone(this.profiles); }
  async importImage(input: Uint8Array): Promise<StoredImage> {
    const info = inspectImage(input), assetId = createHash('sha256').update(input).digest('hex');
    const result = { ...info, assetId, byteLength: input.byteLength };
    if (this.metadata.has(assetId)) return result;
    if (!this.directory) {
      if (this.memory.size >= 256 || this.imageBytes + input.byteLength > 128 * 1024 * 1024) throw new Error('ASSET_STORE_FULL');
      this.memory.set(assetId, input.slice()); this.imageBytes += input.byteLength;
    } else {
      const root = join(this.directory, 'assets', 'avatars');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const existing = (await readdir(root)).filter(n => /^[a-f0-9]{64}$/.test(n));
      let total = 0; for (const name of existing) total += (await lstat(join(root, name))).size;
      if (!existing.includes(assetId) && (existing.length >= 256 || total + input.byteLength > 512 * 1024 * 1024)) throw new Error('ASSET_STORE_FULL');
      const temporary = join(root, `.${randomUUID()}.tmp`), target = join(root, assetId);
      try {
        await writeFile(temporary, input, { flag: 'wx', mode: 0o600 });
        // Content-addressed images are immutable; identical uploads have the same bytes.
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
    }
    this.metadata.set(assetId, result); return result;
  }
  async get(assetId: string): Promise<{ info: StoredImage; bytes: Uint8Array }> {
    if (typeof assetId !== 'string' || !validId(assetId)) throw new Error('ASSET_NOT_FOUND');
    const bytes = this.directory ? await readBounded(join(this.directory, 'assets', 'avatars', assetId), MAX_IMAGE_BYTES) : this.memory.get(assetId);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== assetId) throw new Error('ASSET_NOT_FOUND');
    const info = { ...inspectImage(bytes), assetId, byteLength: bytes.byteLength };
    return { info, bytes };
  }
  async validateDraft(draft: unknown): Promise<AvatarProfile> {
    if (!draft || typeof draft !== 'object') throw new Error('INVALID_AVATAR_PROFILE');
    const p = draft as AvatarProfile;
    const { info } = await this.get(p.assetId).catch(()=>{throw new Error('ASSET_NOT_FOUND');});
    let back;
    if(p.back){const b=await this.get(p.back.assetId).catch(()=>{throw new Error('ASSET_NOT_FOUND');});back={...p.back,image:{width:b.info.width,height:b.info.height,mime:b.info.mime}};}
    return validateProfile({ ...p, ...(back?{back}:{}), image: { width: info.width, height: info.height, mime: info.mime } });
  }
  async saveProfiles(profiles: readonly AvatarProfile[]): Promise<void> {
    if (profiles.length > 256) throw new Error('TOO_MANY_AVATAR_PROFILES');
    const clean = profiles.map(validateProfile);
    if (new Set(clean.map(p => p.userId)).size !== clean.length) throw new Error('INVALID_AVATAR_PROFILE');
    if (this.directory) await writeAtomicJson(join(this.directory,'avatars.json'), {schemaVersion:1,profiles:clean}, 'AVATAR_SETTINGS_WRITE_FAILED', true);
    this.profiles = clean;
  }
}
