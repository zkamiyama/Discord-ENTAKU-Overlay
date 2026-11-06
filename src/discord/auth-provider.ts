import { APP } from '../domain/defaults.ts';
import { DiscordError } from './errors.ts';
import type { RpcClient } from './rpc-client.ts';
export interface AuthProvider {
  readonly clientId: string;
  authenticate(rpc: Pick<RpcClient,'request'>, interactive: boolean): Promise<void>;
  clear(): void;
}
type Fetcher = (url: string, options: RequestInit) => Promise<Response>;
const SCOPES = ['rpc', 'rpc.voice.read'] as const;
/** Opt-in compatibility route, NOT an independently approved Discord application. */
export class StreamKitCompatAuth implements AuthProvider {
  readonly clientId = '207646673902501888';
  private token: string | null = null;
  private expiresAt = Infinity;
  constructor(private consent: boolean, private fetcher: Fetcher = (url, options) => fetch(url, options), private utcNow = Date.now) {}
  clear(): void { this.token = null; this.expiresAt = Infinity; }
  async authenticate(rpc: Pick<RpcClient,'request'>, interactive: boolean): Promise<void> {
    if (!this.consent) throw new DiscordError('COMPAT_CONSENT_REQUIRED');
    if (this.utcNow() >= this.expiresAt) this.clear();
    if (!this.token) {
      if (!interactive) throw new DiscordError('AUTH_REQUIRED');
      let code: unknown;
      try {
        const data = await rpc.request('AUTHORIZE', { client_id: this.clientId, scopes: [...SCOPES] }, undefined, APP.authTimeoutMs) as { code?: unknown };
        code = data?.code;
      } catch (error) {
        throw new DiscordError(error instanceof DiscordError && error.code === 'RPC_TIMEOUT' ? 'AUTH_TIMEOUT' : 'AUTH_DECLINED_OR_SCOPE_DENIED');
      }
      if (typeof code !== 'string' || !code) throw new DiscordError('AUTH_CODE_MISSING');
      try {
        const response = await this.fetcher('https://streamkit.discord.com/overlay/token', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
        });
        if (!response.ok || !response.body) throw new Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 65536) { await reader.cancel(); throw new Error(); } chunks.push(item.value); }
        } finally { reader.releaseLock(); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { access_token?: unknown; expires_in?: unknown };
        if (typeof data.access_token !== 'string' || !data.access_token) throw new Error();
        this.token = data.access_token;
        this.expiresAt = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0 ? this.utcNow() + data.expires_in * 1000 : Infinity;
      } catch { this.clear(); throw new DiscordError('AUTH_EXCHANGE_FAILED'); }
    }
    try { await rpc.request('AUTHENTICATE', { access_token: this.token }); }
    catch { this.clear(); throw new DiscordError('AUTH_REQUIRED'); }
  }
}
