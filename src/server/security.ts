import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export interface AccessKeys { read: string; control: string }
export function newAccessKeys(): AccessKeys { return { read: randomBytes(32).toString('hex'), control: randomBytes(32).toString('hex') }; }
export function roleForKey(value: unknown, keys: AccessKeys): 'read' | 'control' | null {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'hex');
  if (timingSafeEqual(bytes, Buffer.from(keys.control, 'hex'))) return 'control';
  if (timingSafeEqual(bytes, Buffer.from(keys.read, 'hex'))) return 'read';
  return null;
}
export async function loadAccessKeys(directory: string): Promise<AccessKeys> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'access-keys.json');
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'));
    const keys = data as AccessKeys;
    if (!keys || ![keys.read, keys.control].every(s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)) || keys.read === keys.control) throw new Error('INVALID_ACCESS_KEYS');
    return keys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('ACCESS_KEYS_READ_FAILED');
    const keys = newAccessKeys();
    await writeFile(file, JSON.stringify(keys), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return keys;
  }
}
export function validHost(request: Request, port: number): boolean { return request.headers.get('host') === `127.0.0.1:${port}`; }
export function validOrigin(request: Request, port: number): boolean { return request.headers.get('origin') === `http://127.0.0.1:${port}`; }
export function bearerRole(request: Request, keys: AccessKeys): 'read' | 'control' | null {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? roleForKey(authorization.slice(7), keys) : null;
}
