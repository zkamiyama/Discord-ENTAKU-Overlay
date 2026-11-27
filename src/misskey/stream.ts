import type { MisskeySettings, MisskeyStatus } from '../contracts/misskey.ts';

const CHANNEL_ID = 'entaku-hashtag';
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES_PER_SECOND = 100;
const RECOVERY_LIMIT = 100;
const RECOVERY_REQUESTS = 3;
const RECOVERY_COOLDOWN_MS = 15_000;
const RECOVERY_LOOKBACK_MS = 120_000;
const MAX_RETRY_AFTER_MS = 3_600_000;

/** The transport owns sockets, timers and HTTP requests; the feed owns note policy. */
export interface MisskeyStreamFeed {
  readonly settings: MisskeySettings;
  readonly trackedNoteIds: readonly string[];
  observe(listener: () => void): () => void;
  ingest(raw: unknown, source?: 'live' | 'recovery'): boolean;
  remove(id: string): void;
  clear(): void;
  setConnection(status: MisskeyStatus, errorCode?: string | null, retryAt?: number | null): void;
  setRecoveryTruncated(value: boolean): void;
}

export interface MisskeySocket {
  readonly readyState: number;
  send(value: string): unknown;
  ping(value?: string): unknown;
  terminate(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface MisskeyStreamDependencies {
  now(): number;
  random(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  fetch(url: string, options: RequestInit): Promise<Response>;
  createSocket(url: string): MisskeySocket;
}

/** WebSocket does not select the process proxy automatically in Bun 1.4.4. */
export function misskeyProxyFor(url: URL, env: Record<string, string | undefined>): string | undefined {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = url.port || (url.protocol === 'wss:' || url.protocol === 'https:' ? '443' : '80');
  const exclusions = (env.no_proxy ?? env.NO_PROXY ?? '').toLowerCase().split(/[\s,]+/);
  for (const exclusion of exclusions) {
    if (!exclusion) continue;
    if (exclusion === '*') return undefined;
    const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(exclusion);
    if (!match || (match[2] && match[2] !== port)) continue;
    const target = match[1]!.replace(/^\*?\./, '').replace(/\.$/, '');
    if (host === target || host.endsWith(`.${target}`)) return undefined;
  }
  return env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || env.all_proxy || env.ALL_PROXY || undefined;
}

// This server module runs in Bun; lib.dom's constructor omits Bun's proxy/control-frame extensions.
const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): MisskeySocket };
const defaults: MisskeyStreamDependencies = {
  now: Date.now,
  random: Math.random,
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  fetch: (url, options) => fetch(url, options),
  createSocket: url => new BunWebSocket(url, {
    proxy: misskeyProxyFor(new URL(url), process.env),
    perMessageDeflate: false,
  }),
};

interface CursorNote { id: string; createdAt: string }
interface Recovery { epoch: number; cursor: string | null; cursorCreatedAt: number | null; sinceDate: number; attempts: number }
class TransportFailure extends Error {
  constructor(readonly code: string, readonly retryable = true, readonly retryAt = 0) { super(code); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const noteId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function cursorNote(value: unknown, now: number): value is CursorNote {
  if (!object(value) || !noteId(value.id) || typeof value.createdAt !== 'string' || value.createdAt.length > 40) return false;
  const at = Date.parse(value.createdAt);
  return Number.isFinite(at) && at >= 0 && at <= now + 60_000 && object(value.user) && noteId(value.user.id) &&
    (value.text === null || typeof value.text === 'string') &&
    ['public', 'home', 'followers', 'specified'].includes(String(value.visibility));
}
function frameText(data: unknown): string | null {
  if (typeof data === 'string') {
    if (data.length > MAX_FRAME_BYTES || Buffer.byteLength(data) > MAX_FRAME_BYTES) throw new TransportFailure('MISSKEY_FRAME_TOO_LARGE');
    return data;
  }
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes) return null;
  if (bytes.byteLength > MAX_FRAME_BYTES) throw new TransportFailure('MISSKEY_FRAME_TOO_LARGE');
  return new TextDecoder().decode(bytes);
}
function retryAfter(response: Response, now: number): number {
  const header = response.headers.get('retry-after');
  let delay = 60_000;
  if (header) {
    const parsed = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - now;
    if (Number.isFinite(parsed)) delay = parsed;
  }
  return now + Math.max(1000, Math.min(MAX_RETRY_AFTER_MS, delay));
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new TransportFailure('MISSKEY_RECOVERY_TOO_LARGE', false);
  }
  if (!response.body) throw new TransportFailure('MISSKEY_RECOVERY_INVALID', false);
  const reader = response.body.getReader();
  const onAbort = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', onAbort, { once: true });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new TransportFailure('MISSKEY_RECOVERY_TOO_LARGE', false);
      }
      parts.push(result.value);
    }
  } finally { signal.removeEventListener('abort', onAbort); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new TransportFailure('MISSKEY_RECOVERY_INVALID', false); }
}

export class MisskeyStream {
  private readonly deps: MisskeyStreamDependencies;
  private settings: MisskeySettings;
  private running = false;
  private disposed = false;
  private epoch = 0;
  private socket: MisskeySocket | null = null;
  private listeners: [string, EventListener][] = [];
  private readonly timers = new Set<unknown>();
  private requestAbort: AbortController | null = null;
  private unsubscribeFeed: (() => void) | null = null;
  private readonly captured = new Set<string>();
  private acknowledged = false;
  private openTimer: unknown = null;
  private ackTimer: unknown = null;
  private pongTimer: unknown = null;
  private liveSince: number | null = null;
  private failures = 0;
  private checkpoint: string | null = null;
  private checkpointCreatedAt: number | null = null;
  private liveHigh: string | null = null;
  private liveHighCreatedAt: number | null = null;
  private recoverySinceDate = 0;
  private recoveryComplete = false;
  private streamGap = false;
  private lastSearchAt = -Infinity;
  private retryAfterUntil = 0;
  private budgetStartedAt = 0;
  private messages = 0;

  constructor(private readonly feed: MisskeyStreamFeed, dependencies: Partial<MisskeyStreamDependencies> = {}) {
    this.deps = { ...defaults, ...dependencies };
    this.settings = structuredClone(feed.settings);
  }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.failures = 0;
    this.checkpoint = null;
    this.checkpointCreatedAt = null;
    this.recoverySinceDate = Math.max(0, this.deps.now() - RECOVERY_LOOKBACK_MS);
    this.unsubscribeFeed = this.feed.observe(() => this.reconcileCaptures());
    if (this.settings.enabled) this.connect();
    else this.feed.setConnection('disabled');
  }

  /** Call after feed.configure(settings). Display-only changes preserve the connection. */
  configure(settings: MisskeySettings): void {
    if (this.disposed) return;
    const changed = settings.instanceUrl !== this.settings.instanceUrl || settings.hashtag !== this.settings.hashtag || settings.enabled !== this.settings.enabled;
    const newOrigin = settings.instanceUrl !== this.settings.instanceUrl;
    this.settings = structuredClone(settings);
    if (!changed || !this.running) return;
    this.releaseConnection();
    this.feed.clear();
    this.checkpoint = null;
    this.checkpointCreatedAt = null;
    this.failures = 0;
    this.recoverySinceDate = Math.max(0, this.deps.now() - RECOVERY_LOOKBACK_MS);
    if (newOrigin) { this.lastSearchAt = -Infinity; this.retryAfterUntil = 0; }
    if (settings.enabled) this.connect();
    else this.feed.setConnection('disabled');
  }

  stop(): void {
    this.running = false;
    this.releaseConnection();
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
    this.feed.clear();
    this.feed.setConnection('disabled');
  }

  dispose(): void { if (!this.disposed) { this.stop(); this.disposed = true; } }

  private current(epoch: number): boolean { return epoch === this.epoch && this.running && this.settings.enabled && !this.disposed; }
  private schedule(epoch: number, delay: number, callback: () => void): unknown {
    let handle: unknown;
    handle = this.deps.setTimeout(() => { this.timers.delete(handle); if (this.current(epoch)) callback(); }, Math.max(0, delay));
    this.timers.add(handle);
    return handle;
  }
  private cancel(handle: unknown): void {
    if (handle === null) return;
    this.deps.clearTimeout(handle);
    this.timers.delete(handle);
  }
  private releaseConnection(): void {
    this.epoch++;
    this.requestAbort?.abort();
    this.requestAbort = null;
    for (const handle of this.timers) this.deps.clearTimeout(handle);
    this.timers.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      for (const [type, listener] of this.listeners) socket.removeEventListener(type, listener);
      try { socket.terminate(); } catch { /* A failed socket may already be closed. */ }
    }
    this.listeners = [];
    this.captured.clear();
    this.acknowledged = false;
    this.liveSince = null;
    this.openTimer = this.ackTimer = this.pongTimer = null;
  }

  private connect(): void {
    this.releaseConnection();
    const epoch = this.epoch;
    if (!this.current(epoch)) return;
    const cutoff = Math.max(0, this.deps.now() - RECOVERY_LOOKBACK_MS);
    // This is a live card feed, not an archive. An old cursor must not spend
    // the entire page budget on notes which can no longer be displayed.
    if (this.checkpointCreatedAt !== null && this.checkpointCreatedAt < cutoff) {
      this.checkpoint = null;
      this.checkpointCreatedAt = null;
    }
    if (this.checkpoint === null) this.recoverySinceDate = cutoff;
    this.liveHigh = null;
    this.liveHighCreatedAt = null;
    this.recoveryComplete = false;
    this.streamGap = false;
    this.budgetStartedAt = this.deps.now();
    this.messages = 0;
    this.feed.setConnection(this.failures ? 'reconnecting' : 'connecting');
    let url: URL;
    try {
      url = new URL(this.settings.instanceUrl);
      if (url.protocol !== 'https:' || url.origin !== this.settings.instanceUrl || url.username || url.password) throw new Error();
      url.protocol = 'wss:';
      url.pathname = '/streaming';
    } catch { this.feed.setConnection('error', 'MISSKEY_INVALID_INSTANCE'); return; }
    try { this.socket = this.deps.createSocket(url.href); }
    catch { this.fail(epoch, 'MISSKEY_CONNECT_FAILED'); return; }
    const socket = this.socket;
    const listen = (type: string, callback: (event: Event) => void): void => {
      const listener: EventListener = event => { if (this.current(epoch) && this.socket === socket) callback(event); };
      this.listeners.push([type, listener]);
      socket.addEventListener(type, listener);
    };
    listen('open', () => {
      this.cancel(this.openTimer);
      this.ackTimer = this.schedule(epoch, 10_000, () => this.fail(epoch, 'MISSKEY_SUBSCRIBE_TIMEOUT'));
      this.send(epoch, { type: 'connect', body: { channel: 'hashtag', id: CHANNEL_ID, params: { q: [[this.settings.hashtag]] }, pong: true } });
    });
    listen('message', event => this.onMessage(epoch, (event as MessageEvent<unknown>).data));
    listen('pong', () => { this.cancel(this.pongTimer); this.pongTimer = null; });
    listen('close', () => this.fail(epoch, 'MISSKEY_DISCONNECTED'));
    listen('error', () => this.fail(epoch, 'MISSKEY_CONNECT_FAILED'));
    this.openTimer = this.schedule(epoch, 15_000, () => this.fail(epoch, 'MISSKEY_CONNECT_TIMEOUT'));
  }

  private send(epoch: number, value: unknown): boolean {
    if (!this.current(epoch) || this.socket?.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(value)); return true; }
    catch { this.fail(epoch, 'MISSKEY_SEND_FAILED'); return false; }
  }
  private fail(epoch: number, code: string): void {
    if (!this.current(epoch)) return;
    if (this.liveSince !== null && this.deps.now() - this.liveSince >= 30_000) this.failures = 0;
    const attempt = this.failures++;
    // Jitter always stays inside [1s, 60s]; a flapping open event never resets it.
    const ceiling = Math.min(60_000, 1000 * 2 ** Math.min(6, attempt));
    const jitter = Math.max(0, Math.min(1, this.deps.random()));
    const delay = Math.max(1000, Math.round(ceiling * (0.5 + jitter * 0.5)));
    this.releaseConnection();
    this.feed.clear();
    const retryAt = this.deps.now() + delay;
    this.feed.setConnection('reconnecting', code, retryAt);
    this.schedule(this.epoch, delay, () => this.connect());
  }

  private onMessage(epoch: number, data: unknown): void {
    const now = this.deps.now();
    if (now - this.budgetStartedAt >= 1000) { this.budgetStartedAt = now; this.messages = 0; }
    if (++this.messages > MAX_MESSAGES_PER_SECOND) {
      const firstGap = !this.streamGap;
      this.streamGap = true;
      this.recoveryComplete = false;
      // Every dropped frame might revoke a currently visible note, including
      // cards admitted in a later budget window or by a pending REST page.
      this.feed.clear();
      this.reconcileCaptures();
      if (!this.current(epoch)) return;
      this.feed.setRecoveryTruncated(true);
      if (firstGap && this.current(epoch)) this.feed.setConnection(this.acknowledged ? 'live' : 'connecting', 'MISSKEY_STREAM_OVERLOAD');
      return;
    }
    let message: unknown;
    try { const text = frameText(data); if (text === null) return; message = JSON.parse(text); }
    catch (error) { if (error instanceof TransportFailure) this.fail(epoch, error.code); return; }
    if (!object(message) || !object(message.body)) return;
    if (message.type === 'connected' && message.body.id === CHANNEL_ID && !this.acknowledged) {
      this.cancel(this.ackTimer);
      this.acknowledged = true;
      this.liveSince = now;
      this.feed.setConnection('live');
      this.reconcileCaptures();
      this.heartbeat(epoch);
      const recovery: Recovery = { epoch, cursor: this.checkpoint, cursorCreatedAt: this.checkpointCreatedAt, sinceDate: this.recoverySinceDate, attempts: 0 };
      const wait = Math.max(this.lastSearchAt + RECOVERY_COOLDOWN_MS, this.retryAfterUntil) - now;
      if (wait > 0) this.feed.setConnection('live', null, now + wait);
      this.schedule(epoch, wait, () => { void this.recoverPage(recovery); });
      return;
    }
    if (!this.acknowledged) return;
    if (message.type === 'channel' && message.body.id === CHANNEL_ID && message.body.type === 'note') {
      const raw = message.body.body;
      if (cursorNote(raw, now)) {
        if (this.liveHigh === null || raw.id > this.liveHigh) {
          this.liveHigh = raw.id;
          this.liveHighCreatedAt = Date.parse(raw.createdAt);
        }
        if (this.recoveryComplete) this.advanceCheckpoint(raw.id, Date.parse(raw.createdAt));
      }
      this.feed.ingest(raw, 'live');
      this.reconcileCaptures();
    } else if (message.type === 'noteUpdated' && noteId(message.body.id) && this.captured.has(message.body.id)) {
      if (message.body.type === 'deleted' || message.body.type === 'updated') {
        // An edit lacks complete tags/visibility. Remove it instead of showing unchecked text.
        this.feed.remove(message.body.id);
        this.reconcileCaptures();
      }
    }
  }

  private advanceCheckpoint(id: string, createdAt: number): void {
    if (this.checkpoint === null || id > this.checkpoint) {
      this.checkpoint = id;
      this.checkpointCreatedAt = createdAt;
    }
  }

  private heartbeat(epoch: number): void {
    this.schedule(epoch, 30_000, () => {
      if (!this.socket || !this.acknowledged) return;
      this.pongTimer = this.schedule(epoch, 15_000, () => this.fail(epoch, 'MISSKEY_HEARTBEAT_TIMEOUT'));
      try { this.socket.ping('entaku'); }
      catch { this.fail(epoch, 'MISSKEY_HEARTBEAT_FAILED'); return; }
      this.heartbeat(epoch);
    });
  }

  private reconcileCaptures(): void {
    if (!this.acknowledged || !this.socket || !this.current(this.epoch)) return;
    const wanted = new Set(this.feed.trackedNoteIds.slice(0, 90).filter(noteId));
    const epoch = this.epoch;
    for (const id of this.captured) if (!wanted.has(id)) {
      this.captured.delete(id);
      if (!this.send(epoch, { type: 'unsubNote', body: { id } })) return;
    }
    for (const id of wanted) if (!this.captured.has(id)) {
      this.captured.add(id);
      if (!this.send(epoch, { type: 'subNote', body: { id } })) return;
    }
  }

  private async recoveryRequest(recovery: Recovery): Promise<unknown[]> {
    const controller = new AbortController();
    this.requestAbort = controller;
    const body = { tag: this.settings.hashtag, limit: RECOVERY_LIMIT, ...(recovery.cursor ? { sinceId: recovery.cursor } : { sinceDate: recovery.sinceDate }) };
    let timeout: unknown;
    let onAbort: () => void;
    const deadline = new Promise<never>((_, reject) => {
      onAbort = () => reject(new TransportFailure('MISSKEY_RECOVERY_ABORTED', false));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timeout = this.schedule(recovery.epoch, 8000, () => { reject(new TransportFailure('MISSKEY_RECOVERY_TIMEOUT')); controller.abort(); });
    });
    const url = `${this.settings.instanceUrl}/api/notes/search-by-tag`;
    const request = Promise.resolve().then(() => this.deps.fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: controller.signal,
    })).then(async response => {
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new TransportFailure('MISSKEY_RECOVERY_ABORTED', false); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 429) throw new TransportFailure('MISSKEY_RATE_LIMITED', true, retryAfter(response, this.deps.now()));
        throw new TransportFailure(response.status === 401 || response.status === 403 ? 'MISSKEY_RECOVERY_FORBIDDEN' : 'MISSKEY_RECOVERY_HTTP_ERROR', response.status >= 500);
      }
      const result = await boundedJson(response, controller.signal);
      if (!Array.isArray(result) || result.length > RECOVERY_LIMIT || !result.every(note => cursorNote(note, this.deps.now()))) throw new TransportFailure('MISSKEY_RECOVERY_INVALID', false);
      return result;
    });
    try { return await Promise.race([request, deadline]); }
    finally { this.cancel(timeout); controller.signal.removeEventListener('abort', onAbort!); if (this.requestAbort === controller) this.requestAbort = null; }
  }

  private async recoverPage(recovery: Recovery): Promise<void> {
    if (!this.current(recovery.epoch)) return;
    recovery.attempts++;
    this.lastSearchAt = this.deps.now();
    try {
      const notes = await this.recoveryRequest(recovery);
      if (!this.current(recovery.epoch)) return;
      const prior = recovery.cursor;
      // sinceId/sinceDate use ascending IDs on the target instance. Do not use display acceptance as the cursor.
      const ordered = (notes as CursorNote[]).slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      for (const note of ordered) {
        this.feed.ingest(note, 'recovery');
        if (recovery.cursor === null || note.id > recovery.cursor) {
          recovery.cursor = note.id;
          recovery.cursorCreatedAt = Date.parse(note.createdAt);
        }
      }
      if (recovery.cursor !== null && recovery.cursorCreatedAt !== null) this.advanceCheckpoint(recovery.cursor, recovery.cursorCreatedAt);
      this.reconcileCaptures();
      if (notes.length < RECOVERY_LIMIT) {
        this.recoveryComplete = !this.streamGap;
        if (this.recoveryComplete && this.liveHigh !== null && this.liveHighCreatedAt !== null) this.advanceCheckpoint(this.liveHigh, this.liveHighCreatedAt);
        this.feed.setRecoveryTruncated(this.streamGap);
        this.feed.setConnection('live', this.streamGap ? 'MISSKEY_STREAM_OVERLOAD' : null);
        return;
      }
      if (recovery.cursor === prior) throw new TransportFailure('MISSKEY_RECOVERY_STALLED', false);
      if (recovery.attempts >= RECOVERY_REQUESTS) {
        this.feed.setRecoveryTruncated(true);
        this.feed.setConnection('live', 'MISSKEY_RECOVERY_TRUNCATED');
        return;
      }
      this.schedule(recovery.epoch, Math.max(0, this.lastSearchAt + 1000 - this.deps.now()), () => { void this.recoverPage(recovery); });
    } catch (error) {
      if (!this.current(recovery.epoch)) return;
      const failure = error instanceof TransportFailure ? error : new TransportFailure('MISSKEY_RECOVERY_FAILED');
      this.retryAfterUntil = Math.max(this.retryAfterUntil, failure.retryAt);
      this.feed.setRecoveryTruncated(true);
      if (failure.retryable && recovery.attempts < RECOVERY_REQUESTS) {
        const retryAt = Math.max(this.lastSearchAt + RECOVERY_COOLDOWN_MS * 2 ** (recovery.attempts - 1), this.retryAfterUntil);
        this.feed.setConnection('live', failure.code, retryAt);
        this.schedule(recovery.epoch, retryAt - this.deps.now(), () => { void this.recoverPage(recovery); });
      } else this.feed.setConnection('live', failure.code);
    }
  }
}
