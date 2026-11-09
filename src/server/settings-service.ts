import type {AppEngine} from '../domain/engine.ts';
import type {AvatarStore} from '../assets/store.ts';
import type {StudioStore} from '../studio/store.ts';
import type {PresetStore} from '../presets/store.ts';
import {capturePreset, validatePreset} from '../presets/schema.ts';

/** In-process compensation, not crash recovery. Each store must reject before
 * committing or return success. Every completed write gets its own undo. */
class SettingsWrites {
  private undos: Array<() => Promise<unknown>> = [];
  async step<T>(write: () => Promise<T>, undo: () => Promise<unknown>): Promise<T> {
    const result = await write();
    this.undos.push(undo);
    return result;
  }
  async reject(cause: unknown, code: string): Promise<never> {
    let failed = false;
    for (const undo of this.undos.reverse()) {
      try { await undo(); } catch { failed = true; }
    }
    if (failed) throw new Error(code);
    throw cause;
  }
}

/** HTTP owns serialization/idempotency; this service owns settings consistency.
 * It never rolls back unrelated Discord events received during filesystem I/O. */
export class SettingsService {
  constructor(
    private engine: AppEngine,
    private studios: StudioStore,
    private avatars: AvatarStore,
    private presets: PresetStore,
    private now: () => number,
  ) {}

  private guard(revision: number, preset = false): () => void {
    const context = this.engine.settingsContextVersion;
    const check = () => {
      if (this.engine.settingsContextVersion !== context) {
        throw new Error(preset ? 'PRESET_CONTEXT_CHANGED' : 'SETTINGS_CONTEXT_CHANGED');
      }
      if (this.engine.snapshot().revision !== revision) throw new Error('REVISION_CONFLICT');
    };
    check();
    return check;
  }

  async scene(input: unknown, revision: number): Promise<void> {
    const check = this.guard(revision);
    const clean = await this.studios.validateDraft(input);
    check();
    const before = this.studios.snapshot(), writes = new SettingsWrites();
    try {
      const saved = await writes.step(() => this.studios.save(clean), () => this.studios.restore(before));
      check();
      this.engine.setStudioScene(saved, revision, this.now());
    } catch (error) { await writes.reject(error, 'SETTINGS_ROLLBACK_FAILED'); }
  }

  async avatar(input: unknown, revision: number): Promise<void> {
    const check = this.guard(revision);
    const profile = await this.avatars.validateDraft(input);
    check();
    await this.profiles([...this.engine.snapshot().avatarProfiles.filter(p => p.userId !== profile.userId), profile], revision, check);
  }

  async resetAvatar(userId: string, revision: number): Promise<void> {
    const check = this.guard(revision);
    await this.profiles(this.engine.snapshot().avatarProfiles.filter(p => p.userId !== userId), revision, check);
  }

  private async profiles(profiles: ReturnType<AvatarStore['snapshot']>, revision: number, check: () => void): Promise<void> {
    const before = this.avatars.snapshot(), writes = new SettingsWrites();
    try {
      await writes.step(() => this.avatars.saveProfiles(profiles), () => this.avatars.saveProfiles(before));
      check();
      this.engine.setAvatarProfiles(profiles, revision, this.now());
    } catch (error) { await writes.reject(error, 'SETTINGS_ROLLBACK_FAILED'); }
  }

  async preset(name: string, revision: number): Promise<Record<string, unknown>> {
    const check = this.guard(revision, true);
    const p = await this.presets.read(name);
    const scene = await this.studios.validateDraft(p.studio);
    for (const item of scene.objects) if (item.kind === 'model') {
      for (const file of (await this.studios.bundle(item.bundleId)).files) await this.studios.file(item.bundleId, file.path);
    }
    const profiles = await Promise.all(p.avatarProfiles.map(a => this.avatars.validateDraft(a)));
    const clean = validatePreset({...p, studio:scene, avatarProfiles:profiles});
    const oldScene = this.studios.snapshot(), oldProfiles = this.avatars.snapshot();
    const oldPreferences = await this.presets.preferences();
    check();
    const writes = new SettingsWrites();
    try {
      clean.studio = await writes.step(() => this.studios.save(clean.studio), () => this.studios.restore(oldScene));
      check();
      await writes.step(() => this.avatars.saveProfiles(clean.avatarProfiles), () => this.avatars.saveProfiles(oldProfiles));
      check();
      await writes.step(() => this.presets.preferences(clean), () => this.presets.preferences(oldPreferences));
      check();
      this.engine.applyPreset(clean, revision, this.now());
    } catch (error) { await writes.reject(error, 'PRESET_ROLLBACK_FAILED'); }
    return {presetName:name, theme:p.theme, presetSignature:JSON.stringify(capturePreset(this.engine.snapshot(), p.theme))};
  }
}
