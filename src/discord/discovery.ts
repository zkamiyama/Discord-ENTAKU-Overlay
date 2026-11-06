import { posix } from 'node:path';
import { RpcClient, type RpcOptions } from './rpc-client.ts';
import { DiscordError } from './errors.ts';

export function ipcCandidates(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const roots = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter((s): s is string => !!s))];
  return roots.flatMap(root => Array.from({ length: 10 }, (_, i) => posix.join(root, `discord-ipc-${i}`)));
}
export async function discover(clientId: string, options: RpcOptions = {}, paths = ipcCandidates()): Promise<{ client: RpcClient; path: string }> {
  for (const path of paths) {
    try { return { client: await RpcClient.connect(path, clientId, options), path }; }
    catch (error) {
      if (error instanceof DiscordError && error.code === 'INVALID_CLIENT_ID') throw error;
    }
  }
  throw new DiscordError('IPC_NOT_FOUND');
}
