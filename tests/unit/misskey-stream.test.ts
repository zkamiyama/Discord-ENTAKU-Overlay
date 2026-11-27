import { expect, test } from 'bun:test';
import type { MisskeySettings, MisskeyStatus } from '../../src/contracts/misskey.ts';
import { MisskeyStream, misskeyProxyFor } from '../../src/misskey/stream.ts';
import type { MisskeySocket, MisskeyStreamFeed } from '../../src/misskey/stream.ts';

const BASE = 1_800_000_000_000;
const settings = (): MisskeySettings => ({ enabled: true, instanceUrl: 'https://otomad.site', hashtag: 'NicoMiss', localOnly: true, includeHome: false,
  maxCards: 30, maxPerUser: 1, lifetimeMs: 30_000, maxCharacters: 180, blockedWords: [], blockedUsers: [] });
const note = (id: number, overrides: Record<string, unknown> = {}) => ({ id: `n${String(id).padStart(5, '0')}`,
  createdAt: new Date(BASE - 1000).toISOString(), user: { id: 'user1', username: 'test', host: null },
  visibility: 'public', text: `synthetic ${id} #NicoMiss`, tags: ['nicomiss'], ...overrides });
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

class Clock {
  now = BASE;
  next = 1;
  timers = new Map<number, { at: number; run: () => void }>();
  setTimeout = (run: () => void, delay: number): number => { const id = this.next++; this.timers.set(id, { at: this.now + delay, run }); return id; };
  clearTimeout = (id: unknown): void => { this.timers.delete(id as number); };
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    await flush();
    for (let count = 0; count < 10_000; count++) {
      const first = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!first) { this.now = end; await flush(); return; }
      const [id, timer] = first;
      this.now = timer.at;
      this.timers.delete(id);
      timer.run();
      await flush();
    }
    throw new Error('Unexpected timer loop');
  }
}
class Feed implements MisskeyStreamFeed {
  settings = settings();
  connection: { status: MisskeyStatus; errorCode: string | null; retryAt: number | null } = { status: 'disabled', errorCode: null, retryAt: null };
  listeners = new Set<() => void>();
  tracked = new Map<string, unknown>();
  ingested: { raw: unknown; source: 'live' | 'recovery' }[] = [];
  removed: string[] = [];
  rejectIds = new Set<string>();
  recoveryTruncated = false;
  clears = 0;
  get trackedNoteIds(): readonly string[] { return [...this.tracked.keys()]; }
  observe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(): void { for (const listener of this.listeners) listener(); }
  ingest(raw: unknown, source: 'live' | 'recovery' = 'live'): boolean {
    this.ingested.push({ raw, source });
    const id = (raw as { id?: string } | null)?.id;
    if (!id || this.rejectIds.has(id)) return false;
    if (this.tracked.size < 90) this.tracked.set(id, raw);
    this.emit();
    return true;
  }
  remove(id: string): void { this.removed.push(id); this.tracked.delete(id); this.emit(); }
  clear(): void { this.clears++; this.tracked.clear(); this.emit(); }
  setConnection(status: MisskeyStatus, errorCode: string | null = null, retryAt: number | null = null): void { this.connection = { status, errorCode, retryAt }; this.emit(); }
  setRecoveryTruncated(value: boolean): void { this.recoveryTruncated = value; this.emit(); }
}
class Socket implements MisskeySocket {
  readyState = 0;
  target = new EventTarget();
  historical = new Map<string, EventListener[]>();
  sent: { type: string; body: Record<string, unknown> }[] = [];
  pings: string[] = [];
  terminated = 0;
  autoPong = true;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: EventListener): void {
    this.target.addEventListener(type, listener);
    const list = this.historical.get(type) ?? []; list.push(listener); this.historical.set(type, list);
  }
  removeEventListener(type: string, listener: EventListener): void { this.target.removeEventListener(type, listener); }
  send(value: string): void { this.sent.push(JSON.parse(value)); }
  ping(value = ''): void { this.pings.push(value); if (this.autoPong) this.target.dispatchEvent(new Event('pong')); }
  terminate(): void { this.terminated++; this.readyState = 3; }
  open(): void { this.readyState = 1; this.target.dispatchEvent(new Event('open')); }
  message(message: unknown): void { this.target.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  ack(): void { this.message({ type: 'connected', body: { id: 'entaku-hashtag' } }); }
  note(value: unknown): void { this.message({ type: 'channel', body: { id: 'entaku-hashtag', type: 'note', body: value } }); }
  close(): void { this.readyState = 3; this.target.dispatchEvent(new Event('close')); }
}
type Reply = () => Response | Promise<Response>;
function setup(replies: Reply[] = []) {
  const clock = new Clock(), feed = new Feed(), sockets: Socket[] = [];
  const requests: { url: string; options: RequestInit; body: Record<string, unknown>; at: number }[] = [];
  const stream = new MisskeyStream(feed, {
    now: () => clock.now, random: () => 1, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    createSocket: url => { const socket = new Socket(url); sockets.push(socket); return socket; },
    fetch: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body as string), at: clock.now });
      return await (replies.shift()?.() ?? Response.json([]));
    },
  });
  const connect = async (): Promise<Socket> => {
    const socket = sockets.at(-1)!; socket.open(); socket.ack(); await clock.advance(0); return socket;
  };
  return { clock, feed, stream, sockets, requests, connect, replies };
}

test('hashtag waits for the matching ACK, then starts one bounded catchup without polling', async () => {
  const f = setup(); f.stream.start(); f.stream.start();
  expect(f.sockets).toHaveLength(1);
  const socket = f.sockets[0]!; socket.open();
  expect(socket.url).toBe('wss://otomad.site/streaming');
  expect(socket.sent[0]).toEqual({ type: 'connect', body: { channel: 'hashtag', id: 'entaku-hashtag', params: { q: [['NicoMiss']] }, pong: true } });
  expect(f.feed.connection.status).toBe('connecting');
  socket.message({ type: 'connected', body: { id: 'wrong-channel' } });
  await f.clock.advance(500);
  expect(f.requests).toHaveLength(0);
  socket.ack(); await f.clock.advance(0);
  expect(f.feed.connection).toEqual({ status: 'live', errorCode: null, retryAt: null });
  expect(f.requests[0]?.body).toEqual({ tag: 'NicoMiss', limit: 100, sinceDate: BASE - 120_000 });
  expect(f.requests[0]?.options.redirect).toBe('error');
  await f.clock.advance(120_000);
  expect(socket.pings).toHaveLength(4);
  expect(f.requests).toHaveLength(1);
  f.stream.dispose(); expect(f.clock.timers.size).toBe(0); expect(f.feed.listeners.size).toBe(0);
});

test('open/ACK timeouts back off and stale handlers cannot activate replaced sockets', async () => {
  const f = setup(); f.stream.start(); const first = f.sockets[0]!;
  const staleOpen = first.historical.get('open')![0]!;
  await f.clock.advance(15_000);
  expect(f.feed.connection).toMatchObject({ status: 'reconnecting', errorCode: 'MISSKEY_CONNECT_TIMEOUT', retryAt: BASE + 16_000 });
  staleOpen(new Event('open')); expect(first.sent).toHaveLength(0);
  await f.clock.advance(1000); const second = f.sockets[1]!; second.open();
  const staleMessage = second.historical.get('message')![0]!;
  await f.clock.advance(10_000);
  expect(f.feed.connection).toMatchObject({ errorCode: 'MISSKEY_SUBSCRIBE_TIMEOUT', retryAt: BASE + 28_000 });
  staleMessage(new MessageEvent('message', { data: JSON.stringify({ type: 'connected', body: { id: 'entaku-hashtag' } }) }));
  expect(f.feed.connection.status).toBe('reconnecting'); expect(f.requests).toHaveLength(0);
  await f.clock.advance(2000); await f.connect();
  expect(f.feed.connection.status).toBe('live');
  f.stream.stop();
});

test('quiet tags stay connected with control pong; missing pong clears cards and reconnects', async () => {
  const f = setup(); f.stream.start(); const socket = await f.connect();
  socket.note(note(1)); expect(f.feed.trackedNoteIds).toEqual(['n00001']);
  socket.autoPong = false;
  await f.clock.advance(30_000); expect(socket.pings).toHaveLength(1); expect(f.feed.connection.status).toBe('live');
  await f.clock.advance(15_000);
  expect(f.feed.connection).toMatchObject({ status: 'reconnecting', errorCode: 'MISSKEY_HEARTBEAT_TIMEOUT' });
  expect(f.feed.trackedNoteIds).toEqual([]); expect(socket.terminated).toBe(1);
  await f.clock.advance(1000); expect(f.sockets).toHaveLength(2);
  f.stream.stop();
});

test('ASC catchup advances past rejected notes and does not jump over pages to simultaneous live notes', async () => {
  const first = Array.from({ length: 100 }, (_, i) => note(i + 1));
  const f = setup([() => Response.json(first), () => Response.json([note(101)])]);
  f.feed.rejectIds.add('n00101');
  f.stream.start(); const socket = await f.connect();
  socket.note(note(500));
  await f.clock.advance(999); expect(f.requests).toHaveLength(1);
  await f.clock.advance(1);
  expect(f.requests[1]?.body).toEqual({ tag: 'NicoMiss', limit: 100, sinceId: 'n00100' });
  expect(f.feed.recoveryTruncated).toBe(false);
  socket.close(); await f.clock.advance(1000); await f.connect();
  expect(f.requests).toHaveLength(2);
  await f.clock.advance(14_000);
  expect(f.requests[2]?.body.sinceId).toBe('n00500');
  f.stream.stop();
});

test('three full pages retain the covered cursor; later live notes cannot hide a truncated gap', async () => {
  const page = (start: number): Reply => () => Response.json(Array.from({ length: 100 }, (_, i) => note(start + i)));
  const f = setup([page(1), page(101), page(201), () => Response.json([note(301)])]);
  f.stream.start(); const socket = await f.connect(); socket.note(note(900));
  await f.clock.advance(2000);
  expect(f.requests).toHaveLength(3); expect(f.feed.recoveryTruncated).toBe(true);
  expect(f.requests.map(r => r.body.sinceId)).toEqual([undefined, 'n00100', 'n00200']);
  await f.clock.advance(1000); socket.note(note(901)); socket.close();
  await f.clock.advance(1000); await f.connect();
  await f.clock.advance(13_000);
  expect(f.requests).toHaveLength(4); expect(f.requests[3]?.body.sinceId).toBe('n00300');
  expect(f.feed.recoveryTruncated).toBe(false);
  f.stream.stop();
});

test('all valid rejected raw notes still advance the reconnect watermark', async () => {
  const f = setup([() => Response.json([note(4, { visibility: 'home' })])]);
  f.feed.rejectIds.add('n00004'); f.feed.rejectIds.add('n00005');
  f.stream.start(); const socket = await f.connect();
  socket.note(note(5, { user: { id: 'remote1', username: 'remote', host: 'remote.example' } }));
  expect(f.feed.trackedNoteIds).toEqual([]);
  socket.close(); await f.clock.advance(1000); await f.connect(); await f.clock.advance(14_000);
  expect(f.requests[1]?.body.sinceId).toBe('n00005');
  f.stream.stop();
});

test('a checkpoint older than the display window restarts from the recent two minutes', async () => {
  const f = setup([() => Response.json([note(1)])]);
  f.stream.start(); const socket = await f.connect();
  await f.clock.advance(125_000); socket.close();
  await f.clock.advance(1000); await f.connect();
  expect(f.requests[1]?.body).toEqual({ tag: 'NicoMiss', limit: 100, sinceDate: BASE + 6000 });
  expect(f.feed.recoveryTruncated).toBe(false);
  f.stream.stop();
});

test('timestamps more than sixty seconds in the future cannot advance the checkpoint', async () => {
  const f = setup([() => Response.json([note(1)])]);
  f.stream.start(); const socket = await f.connect();
  socket.note(note(999, { createdAt: new Date(BASE + 60_001).toISOString() }));
  socket.close(); await f.clock.advance(1000); await f.connect(); await f.clock.advance(14_000);
  expect(f.requests[1]?.body.sinceId).toBe('n00001');
  f.stream.stop();
});

test('429 Retry-After survives socket replacement and repeated errors have a finite retry budget', async () => {
  const f = setup([() => new Response(null, { status: 429, headers: { 'Retry-After': '90' } }),
    () => new Response(null, { status: 503 }), () => new Response(null, { status: 503 }), () => new Response(null, { status: 503 })]);
  f.stream.start(); const socket = await f.connect();
  expect(f.feed.connection).toMatchObject({ status: 'live', errorCode: 'MISSKEY_RATE_LIMITED', retryAt: BASE + 90_000 });
  socket.close(); await f.clock.advance(1000); await f.connect();
  await f.clock.advance(88_999); expect(f.requests).toHaveLength(1);
  await f.clock.advance(1); expect(f.requests).toHaveLength(2);
  await f.clock.advance(15_000); expect(f.requests).toHaveLength(3);
  await f.clock.advance(30_000); expect(f.requests).toHaveLength(4);
  expect(f.feed.recoveryTruncated).toBe(true);
  await f.clock.advance(120_000); expect(f.requests).toHaveLength(4);
  f.stream.stop();
});

test('Retry-After accepts HTTP dates and caps an excessive wait at one hour', async () => {
  for (const [header, expected] of [[new Date(BASE + 45_000).toUTCString(), 45_000], ['999999999', 3_600_000]] as const) {
    const f = setup([() => new Response(null, { status: 429, headers: { 'Retry-After': header } })]);
    f.stream.start(); await f.connect(); expect(f.feed.connection.retryAt).toBe(BASE + expected); f.stream.stop();
  }
});

test('capture subscriptions are unique and bounded; deleted and edited cards unsubscribe immediately', async () => {
  const f = setup(); f.stream.start(); const socket = await f.connect();
  socket.note(note(1)); socket.note(note(1)); f.feed.emit();
  expect(socket.sent.filter(message => message.type === 'subNote')).toEqual([{ type: 'subNote', body: { id: 'n00001' } }]);
  socket.message({ type: 'noteUpdated', body: { id: 'n00001', type: 'deleted', body: {} } });
  expect(f.feed.trackedNoteIds).toEqual([]);
  expect(socket.sent.at(-1)).toEqual({ type: 'unsubNote', body: { id: 'n00001' } });
  socket.note(note(2)); socket.message({ type: 'noteUpdated', body: { id: 'n00002', type: 'updated', body: { text: 'unreviewed', cw: null } } });
  socket.message({ type: 'noteUpdated', body: { id: 'not-tracked', type: 'deleted', body: {} } });
  expect(f.feed.removed).toEqual(['n00001', 'n00002']);
  for (let i = 1; i <= 150; i++) f.feed.tracked.set(note(i).id, note(i));
  f.feed.emit();
  expect(socket.sent.filter(message => message.type === 'subNote')).toHaveLength(92);
  f.feed.clear(); expect(socket.sent.filter(message => message.type === 'unsubNote')).toHaveLength(92);
  f.stream.stop();
});

test('stop aborts an in-flight response and removes timers; late HTTP and socket data stay inert', async () => {
  let resolve!: (value: Response) => void;
  const f = setup([() => new Promise<Response>(done => { resolve = done; })]);
  f.stream.start(); const socket = await f.connect();
  const stale = socket.historical.get('message')![0]!;
  const signal = f.requests[0]!.options.signal!;
  f.stream.stop(); expect(signal.aborted).toBe(true); expect(f.clock.timers.size).toBe(0);
  resolve(Response.json([note(1)]));
  stale(new MessageEvent('message', { data: JSON.stringify({ type: 'channel', body: { id: 'entaku-hashtag', type: 'note', body: note(2) } }) }));
  await f.clock.advance(60_000);
  expect(f.feed.ingested).toEqual([]); expect(f.requests).toHaveLength(1); expect(f.feed.connection.status).toBe('disabled');
});

test('changing the source invalidates a pending page and resets only that source cursor', async () => {
  let resolve!: (value: Response) => void;
  const f = setup([() => new Promise<Response>(done => { resolve = done; })]);
  f.stream.start(); await f.connect();
  const previousSignal = f.requests[0]!.options.signal!;
  const next = { ...f.feed.settings, instanceUrl: 'https://example.social', hashtag: 'Other' };
  f.feed.settings = next; f.stream.configure(next); await f.connect();
  expect(previousSignal.aborted).toBe(true);
  resolve(Response.json([note(1)])); await flush();
  expect(f.requests[1]?.url).toBe('https://example.social/api/notes/search-by-tag');
  expect(f.requests[1]?.body).toEqual({ tag: 'Other', limit: 100, sinceDate: BASE - 120_000 });
  expect(f.feed.ingested).toEqual([]);
  f.stream.configure({ ...next, maxCards: 12 }); expect(f.sockets).toHaveLength(2);
  f.stream.stop();
});

test('a stalled HTTP request times out at eight seconds and retry is spaced by fifteen seconds', async () => {
  const f = setup([() => new Promise<Response>(() => {})]);
  f.stream.start(); await f.connect(); await f.clock.advance(8000);
  expect(f.requests[0]?.options.signal?.aborted).toBe(true);
  expect(f.feed.connection.errorCode).toBe('MISSKEY_RECOVERY_TIMEOUT');
  await f.clock.advance(6999); expect(f.requests).toHaveLength(1);
  await f.clock.advance(1); expect(f.requests).toHaveLength(2);
  expect(f.feed.recoveryTruncated).toBe(false); f.stream.stop();
});

test('oversized REST and WebSocket input is bounded; flood drops cannot advance the recovery cursor', async () => {
  const f = setup([() => new Response('[]', { headers: { 'Content-Length': String(3 * 1024 * 1024) } })]);
  f.stream.start(); const socket = await f.connect();
  expect(f.feed.connection.errorCode).toBe('MISSKEY_RECOVERY_TOO_LARGE');
  expect(f.feed.recoveryTruncated).toBe(true);
  socket.target.dispatchEvent(new MessageEvent('message', { data: 'x'.repeat(256 * 1024 + 1) }));
  expect(f.feed.connection.errorCode).toBe('MISSKEY_FRAME_TOO_LARGE');
  f.stream.stop();

  const flood = setup(); flood.stream.start(); const s = await flood.connect();
  for (let i = 1; i <= 120; i++) s.note(note(i));
  expect(flood.feed.ingested.length).toBeLessThanOrEqual(100);
  expect(flood.feed.connection.errorCode).toBe('MISSKEY_STREAM_OVERLOAD');
  expect(flood.feed.trackedNoteIds).toEqual([]);
  await flood.clock.advance(1000); s.note(note(999)); s.close();
  await flood.clock.advance(1000); await flood.connect(); await flood.clock.advance(13_000);
  const last = flood.requests.at(-1)!;
  expect(last.body.sinceId).not.toBe('n00999');
  expect(String(last.body.sinceId) < 'n00100').toBe(true);
  flood.stream.stop();
});

test('disabled settings never create a connection; NO_PROXY bypasses the inherited proxy', () => {
  const f = setup(); f.feed.settings.enabled = false;
  const stream = new MisskeyStream(f.feed, { createSocket: () => { throw new Error('must not connect'); } });
  stream.start(); expect(f.feed.connection.status).toBe('disabled'); stream.dispose();
  const env = { HTTPS_PROXY: 'http://proxy.example:8888', HTTP_PROXY: 'http://fallback.example:8080' };
  expect(misskeyProxyFor(new URL('wss://otomad.site/streaming'), env)).toBe(env.HTTPS_PROXY);
  expect(misskeyProxyFor(new URL('wss://otomad.site/streaming'), { ...env, NO_PROXY: '.otomad.site' })).toBeUndefined();
  expect(misskeyProxyFor(new URL('wss://sub.otomad.site/streaming'), { ...env, NO_PROXY: 'otomad.site:443' })).toBeUndefined();
  expect(misskeyProxyFor(new URL('wss://otomad.site/streaming'), { ...env, NO_PROXY: 'otomad.site:8443' })).toBe(env.HTTPS_PROXY);
  expect(misskeyProxyFor(new URL('wss://otomad.site/streaming'), { ...env, NO_PROXY: '*' })).toBeUndefined();
});

test('repeated overload clears later cards even when a recovery page completes between dropped deletions', async () => {
  let resolve!: (response: Response) => void;
  const f = setup([() => new Promise<Response>(done => { resolve = done; })]);
  f.stream.start(); const socket = await f.connect();
  for (let i = 1; i <= 120; i++) socket.note(note(i));
  expect(f.feed.trackedNoteIds).toEqual([]);
  await f.clock.advance(1000);
  socket.note(note(201));
  resolve(Response.json([note(202)])); await flush();
  expect(f.feed.trackedNoteIds).toEqual(['n00201', 'n00202']);
  expect(f.feed.recoveryTruncated).toBe(true);
  for (let i = 0; i < 99; i++) socket.message({ type: 'ignored', body: {} });
  socket.message({ type: 'noteUpdated', body: { id: 'n00201', type: 'deleted', body: {} } });
  expect(f.feed.trackedNoteIds).toEqual([]);
  expect(socket.sent.slice(-2)).toEqual([
    { type: 'unsubNote', body: { id: 'n00201' } },
    { type: 'unsubNote', body: { id: 'n00202' } },
  ]);
  await f.clock.advance(1000); socket.note(note(999)); socket.close();
  await f.clock.advance(1000); await f.connect(); await f.clock.advance(12_000);
  expect(f.requests.at(-1)?.body.sinceId).toBe('n00202');
  f.stream.stop();
});
