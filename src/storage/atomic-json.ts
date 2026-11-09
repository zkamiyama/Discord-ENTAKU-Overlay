import {copyFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

/** Atomic replacement of ONE file. Multi-file settings use compensating writes;
 * this is not a crash-proof database transaction or a substitute for backups. */
export async function writeAtomicJson(path: string, value: unknown, errorCode: string, backup = false): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600});
    if (backup) {
      try { await copyFile(path, path + '.bak'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await rename(temporary, path);
  } catch {
    throw new Error(errorCode);
  } finally {
    // Cleanup must not turn a committed rename into an apparent write failure.
    await rm(temporary, {force:true}).catch(() => {});
  }
}
