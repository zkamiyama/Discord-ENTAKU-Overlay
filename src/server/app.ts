import type { ServerWebSocket } from 'bun';
import { AppEngine } from '../domain/engine.ts';
import type { AccessKeys } from './security.ts';
import { bearerRole, roleForKey, validHost, validOrigin } from './security.ts';
import { AvatarCache } from './avatar-cache.ts';
import type { DirectorMode, ProviderEvent } from '../contracts/domain.ts';
import { demoParticipant } from '../replay/demo.ts';
export interface WebAsset { body: string; type: string }
export type WebAssets = Record<string, WebAsset>;
interface SocketData { role: 'read' | 'control' | null; timer?: ReturnType<typeof setTimeout>; messages: number; windowStart: number }
export interface ServerOptions {
  engine: AppEngine; keys: AccessKeys; assets: WebAssets; port: number;
  now?: () => number; tick?: () => void; onChange?: () => void;
  retry?: () => void;
}
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
function headers(type = 'application/json'): Record<string,string> {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };
}
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: headers() }); }
export function startServer(options: ServerOptions) {
  const { engine, keys } = options;
  const now = options.now ?? (() => performance.now());
  const clients = new Set<ServerWebSocket<SocketData>>();
  const replies = new Map<string, { body: string; result: unknown }>();
  const avatars = new AvatarCache();
  let demoId = 1000, broadcastAt = -Infinity;
  const send = (socket: ServerWebSocket<SocketData>, message: unknown): void => {
    if (socket.getBufferedAmount() > 1024 * 1024) { socket.close(1013, 'SLOW_CLIENT'); return; }
    socket.send(JSON.stringify(message));
  };
  const snapshot = (): unknown => ({ type: 'snapshot', state: engine.snapshot(now()) });
  const broadcast = (): void => {
    const message = snapshot();
    for (const socket of clients) if (socket.data.role) send(socket, message);
    broadcastAt = performance.now();
  };
  const applyDemo = (event: ProviderEvent): void => { engine.apply(event, now()); options.onChange?.(); };
  const server = Bun.serve<SocketData>({
    hostname: '127.0.0.1', port: options.port, maxRequestBodySize: 65536,
    async fetch(request, server) {
      if (!validHost(request, server.port!)) return json({ error: 'HOST_REJECTED' }, 403);
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        if (request.method !== 'GET' || !validOrigin(request, server.port!)) return json({ error: 'ORIGIN_REJECTED' }, 403);
        if (clients.size >= 8) return json({ error: 'CLIENT_LIMIT' }, 429);
        return server.upgrade(request, { data: { role: null, messages: 0, windowStart: performance.now() } }) ? undefined : json({ error: 'UPGRADE_REQUIRED' }, 400);
      }
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ application: 'Discord ENTAKU Overlay', version: '0.1.0-dev.1', protocolVersion: 1 });
      if (request.method === 'POST' && url.pathname === '/api/commands') {
        if (!validOrigin(request, server.port!)) return json({ error: 'ORIGIN_REJECTED' }, 403);
        if (bearerRole(request, keys) !== 'control') return json({ error: 'CONTROL_AUTH_REQUIRED' }, 403);
        if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
        try {
          const raw = await request.text(); if (Buffer.byteLength(raw) > 16384) return json({ error: 'COMMAND_TOO_LARGE' }, 413);
          const body: unknown = JSON.parse(raw);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_COMMAND');
          const c = body as Record<string,unknown>;
          if (typeof c.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.requestId) || !Number.isSafeInteger(c.expectedRevision)) throw new Error('INVALID_COMMAND');
          const prior = replies.get(c.requestId);
          if (prior) return prior.body === raw ? json(prior.result) : json({ error: 'REQUEST_ID_CONFLICT' }, 409);
          if (c.expectedRevision !== engine.snapshot().revision) return json({ error: 'REVISION_CONFLICT', revision: engine.snapshot().revision }, 409);
          const current = now();
          if (c.type === 'mode' && ['AUTO','MANUAL','HOLD'].includes(String(c.mode))) engine.control({ type: 'mode', mode: c.mode as DirectorMode }, c.expectedRevision as number, current);
          else if (c.type === 'wide') engine.control({ type: 'shot', shot: { kind: 'WIDE', userIds: [] } }, c.expectedRevision as number, current);
          else if (c.type === 'single' && typeof c.userId === 'string') engine.control({ type: 'shot', shot: { kind: 'SINGLE', userIds: [c.userId] } }, c.expectedRevision as number, current);
          else if (c.type === 'release' && typeof c.userId === 'string' && c.confirm === true) engine.control({ type: 'release', userId: c.userId }, c.expectedRevision as number, current);
          else if (c.type === 'new-session' && c.confirm === true) engine.control({ type: 'new-session' }, c.expectedRevision as number, current);
          else if (c.type === 'retry' && options.retry) options.retry();
          else if (engine.snapshot().source === 'demo' && c.type === 'demo-add') {
            const id = String(++demoId);
            applyDemo({ type: 'participant-upsert', participant: demoParticipant(id), sourceGeneration: 1, receivedAtMs: current });
          } else if (engine.snapshot().source === 'demo' && typeof c.userId === 'string') {
            const person = engine.snapshot().participants.find(p => p.userId === c.userId);
            if (!person) throw new Error('TARGET_NOT_PRESENT');
            if (c.type === 'demo-speaking' && typeof c.active === 'boolean') applyDemo({ type: 'speaking', userId: person.userId, state: c.active ? 'active' : 'inactive', sourceGeneration: 1, receivedAtMs: current });
            else if (c.type === 'demo-presence' && typeof c.present === 'boolean') applyDemo(c.present
              ? { type: 'participant-upsert', participant: person, sourceGeneration: 1, receivedAtMs: current }
              : { type: 'participant-left', userId: person.userId, sourceGeneration: 1, receivedAtMs: current });
            else throw new Error('INVALID_COMMAND');
          } else throw new Error('INVALID_COMMAND');
          options.onChange?.(); broadcast();
          const result = { requestId: c.requestId, revision: engine.snapshot().revision, ok: true };
          if (replies.size >= 256) replies.delete(replies.keys().next().value!);
          replies.set(c.requestId, { body: raw, result }); return json(result);
        } catch (error) {
          const code = error instanceof Error && ['INVALID_COMMAND','TARGET_NOT_PRESENT','CANNOT_RELEASE_PRESENT_USER','RESERVATION_NOT_FOUND','NO_CHANNEL'].includes(error.message) ? error.message : 'COMMAND_REJECTED';
          return json({ error: code }, 422);
        }
      }
      const avatarMatch = /^\/api\/avatars\/(\d{1,20})$/.exec(url.pathname);
      if (request.method === 'GET' && avatarMatch) {
        if (!bearerRole(request, keys)) return json({ error: 'AUTH_REQUIRED' }, 403);
        const person = engine.snapshot().participants.find(p => p.userId === avatarMatch[1]);
        if (!person?.avatarUrl) return json({ error: 'AVATAR_NOT_FOUND' }, 404);
        try { const data = await avatars.get(person.avatarUrl); return new Response(new Blob([data as Uint8Array<ArrayBuffer>]), { headers: headers('image/png') }); }
        catch { return json({ error: 'AVATAR_UNAVAILABLE' }, 502); }
      }
      if (request.method === 'GET' && url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
      if (request.method === 'GET' && url.pathname === '/') return Response.redirect(`http://127.0.0.1:${server.port}/dock`, 302);
      const asset = options.assets[url.pathname];
      if (request.method === 'GET' && asset) return new Response(asset.body, { headers: headers(asset.type) });
      return json({ error: 'NOT_FOUND' }, 404);
    },
    websocket: {
      maxPayloadLength: 1024 * 1024, backpressureLimit: 1024 * 1024, closeOnBackpressureLimit: true,
      open(socket) {
        if (clients.size >= 8) { socket.close(1013, 'CLIENT_LIMIT'); return; }
        clients.add(socket);
        socket.data.timer = setTimeout(() => socket.close(1008, 'AUTH_TIMEOUT'), 5000);
      },
      message(socket, message) {
        try {
          const time = performance.now();
          if (time - socket.data.windowStart > 1000) { socket.data.windowStart = time; socket.data.messages = 0; }
          if (++socket.data.messages > 30) { socket.close(1008, 'MESSAGE_RATE_LIMIT'); return; }
          if (typeof message !== 'string') throw new Error();
          const p = JSON.parse(message) as Record<string,unknown>;
          if (!socket.data.role) {
            const role = p.type === 'auth' ? roleForKey(p.key, keys) : null;
            if (!role) { socket.close(1008, 'AUTH_REQUIRED'); return; }
            socket.data.role = role; clearTimeout(socket.data.timer);
            send(socket, { type: 'hello', role, ...(role === 'control' ? { overlayUrl: `http://127.0.0.1:${server.port}/overlay#key=${keys.read}` } : {}) });
            send(socket, snapshot()); return;
          }
          if (p.type === 'ping' && typeof p.clientTime === 'number' && Number.isFinite(p.clientTime)) send(socket, { type: 'pong', clientTime: p.clientTime, serverTime: now() });
          else if (p.type === 'resync') send(socket, snapshot());
          else socket.close(1008, 'INVALID_MESSAGE');
        } catch { socket.close(1008, 'INVALID_MESSAGE'); }
      },
      close(socket) { clearTimeout(socket.data.timer); clients.delete(socket); },
    },
    error() { return json({ error: 'INTERNAL_ERROR' }, 500); },
  });
  const timer = setInterval(() => {
    if (options.tick) options.tick(); else engine.tick(now());
    if (performance.now() - broadcastAt >= 95) broadcast();
  }, 50);
  return {
    server, broadcast,
    urls: { overlay: `http://127.0.0.1:${server.port}/overlay#key=${keys.read}`, dock: `http://127.0.0.1:${server.port}/dock#key=${keys.control}` },
    async stop() { clearInterval(timer); for (const socket of clients) socket.close(1001, 'SHUTDOWN'); await server.stop(true); },
  };
}
