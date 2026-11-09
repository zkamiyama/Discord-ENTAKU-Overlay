import { APP } from '../domain/defaults.ts';
import { DiscordError } from './errors.ts';
import type { RpcClient } from './rpc-client.ts';
export interface AuthProbeInfo {requestedScopes:readonly string[];grantedScopes:readonly string[]|null;userId?:string}
export interface AuthProvider {
  probeInfo?():AuthProbeInfo;
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
  private identity:AuthProbeInfo={requestedScopes:SCOPES,grantedScopes:null};
  probeInfo():AuthProbeInfo{return structuredClone(this.identity);}
  private expiresAt = Infinity;
  constructor(private consent: boolean, private fetcher: Fetcher = (url, options) => fetch(url, options), private utcNow = Date.now) {}
  clear(): void { this.token = null; this.expiresAt = Infinity;this.identity={requestedScopes:SCOPES,grantedScopes:null}; }
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
        // A broken pipe or heartbeat is not a user declining authorization.
        if(error instanceof DiscordError&&error.code!=='RPC_REJECTED'&&error.code!=='RPC_TIMEOUT')throw error;
        throw new DiscordError(error instanceof DiscordError && error.code === 'RPC_TIMEOUT' ? 'AUTH_TIMEOUT' : 'AUTH_DECLINED_OR_SCOPE_DENIED',error instanceof DiscordError?error.rpcCode:undefined);
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
    try {
      const raw=await rpc.request('AUTHENTICATE', { access_token: this.token });
      // Retain only explicitly selected metadata; never expose the raw auth response.
      const data=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
      const scopes=Array.isArray(data.scopes)&&data.scopes.length<=64&&data.scopes.every(s=>typeof s==='string'&&/^[a-z][a-z0-9._-]{0,80}$/.test(s))?data.scopes as string[]:null;
      const user=data.user&&typeof data.user==='object'?data.user as Record<string,unknown>:{};
      this.identity={requestedScopes:SCOPES,grantedScopes:scopes,...(typeof user.id==='string'&&/^\d{1,20}$/.test(user.id)?{userId:user.id}:{})};
    }
    catch(error) { this.clear();if(error instanceof DiscordError&&error.code!=='RPC_REJECTED')throw error;throw new DiscordError('AUTH_REQUIRED',error instanceof DiscordError?error.rpcCode:undefined); }
  }
}
