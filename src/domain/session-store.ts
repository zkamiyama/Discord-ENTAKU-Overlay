import { mkdir, readFile, readdir, rename, writeFile, copyFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SeatSession } from '../contracts/domain.ts';
import { validateSession } from './seat-allocator.ts';
export class SessionStore {
  constructor(private directory: string) {}
  async loadAll(): Promise<SeatSession[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = (await readdir(this.directory)).filter(name => /^\d{1,20}\.json$/.test(name));
    if (entries.length > 1024) throw new Error('TOO_MANY_SESSIONS');
    const sessions: SeatSession[] = [];
    for (const name of entries) {
      try {
        const text = await readFile(join(this.directory, name), 'utf8');
        if (Buffer.byteLength(text) > 1024 * 1024) throw new Error();
        const s = validateSession(JSON.parse(text));
        if (`${s.channelId}.json` !== name) throw new Error();
        sessions.push(s);
      } catch { throw new Error('SESSION_READ_FAILED'); } // Do not silently overwrite corrupt data.
    }
    return sessions;
  }
  async save(session: SeatSession): Promise<void> {
    const s = validateSession(session), file = join(this.directory, `${s.channelId}.json`);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `.${s.channelId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(s, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      // Keep one prior version. Other errors must not destroy the previous file.
      try { await copyFile(file, file + '.bak'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(temp, file);
    } finally { await unlink(temp).catch(() => {}); }
  }
}
