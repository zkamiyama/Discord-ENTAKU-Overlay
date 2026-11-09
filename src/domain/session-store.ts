import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {writeAtomicJson} from '../storage/atomic-json.ts';
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
        if ((await stat(join(this.directory, name))).size > 1024 * 1024) throw new Error();
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
    await writeAtomicJson(file,s,'SESSION_WRITE_FAILED',true);
  }
}
