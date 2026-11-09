import {headers,json} from './http.ts';
import {statusRoutes} from './routes/status.ts';
import {assetRoutes} from './routes/assets.ts';
import {commandRoute} from './routes/commands.ts';
import {SettingsService} from './settings-service.ts';
import {VcChatFeed} from '../chat/vc-chat-feed.ts';
import {PresetStore} from '../presets/store.ts';
import { DiagnosticJournal } from '../diagnostics/journal.ts';
import { ProviderRecording } from '../diagnostics/recording.ts';
import type { RenderReport,ReplayControl,ReplayStatus,RuntimeDiagnostics } from '../contracts/diagnostics.ts';
import { StudioStore } from '../studio/store.ts';
import { MAX_STUDIO_UNPACKED_BYTES } from '../studio/manifest.ts';
import { VERSION } from '../version.ts';
import { AvatarStore } from '../assets/store.ts';
import type { ServerWebSocket } from 'bun';
import { AppEngine } from '../domain/engine.ts';
import { validHost, validOrigin } from './security.ts';
import { AvatarCache } from './avatar-cache.ts';
export interface WebAsset { body: string; type: string; encoding?: 'base64' }
export type WebAssets = Record<string, WebAsset>;
interface SocketData { chat?:boolean; messages: number; windowStart: number }
export interface ServerOptions {
  engine: AppEngine; assets: WebAssets; port: number;
  now?: () => number; tick?: () => void; onChange?: () => void;
  retry?: () => void;
  vcChat?: VcChatFeed;
  avatarStore?: AvatarStore;
  studioStore?: StudioStore;
  presets?: PresetStore;
  replay?:{status:()=>ReplayStatus;control:(command:ReplayControl)=>Promise<void>};
}
export function startServer(options: ServerOptions) {
  const { engine } = options;
  const now = options.now ?? (() => performance.now());
  const clients = new Set<ServerWebSocket<SocketData>>();
  const vcChat=options.vcChat??new VcChatFeed('unavailable');
  const journal=new DiagnosticJournal(),recording=new ProviderRecording();
  const reports=new Map<ServerWebSocket<SocketData>,RenderReport>();
  const offEvents=engine.observeEvents((event,ms)=>{journal.event(event,ms);recording.append(event,ms);});
  const diagnostic=():RuntimeDiagnostics=>{
    const state=engine.snapshot(now()),render=[...reports.values()].filter(r=>performance.now()-r.updatedAtMs<10000).sort((a,b)=>b.updatedAtMs-a.updatedAtMs)[0]??null;
    return {version:VERSION,runtime:Bun.version,platform:process.platform,source:state.source,connection:state.connection,errorCode:state.errorCode,participantCount:state.participants.filter(p=>p.presence==='present').length,capacity:state.session.capacity,rssBytes:process.memoryUsage().rss,events:journal.snapshot(),render,recording:recording.info(now()),replay:options.replay?.status()??null};
  };
  const avatars = new AvatarCache();
  const studioStore=options.studioStore??new StudioStore();
  const presets=options.presets??new PresetStore();
  const customAssets = options.avatarStore ?? new AvatarStore();
  const settings=new SettingsService(engine,studioStore,customAssets,presets,now);
  let mutationQueue = Promise.resolve();
  const serial = <T>(work:()=>Promise<T>):Promise<T> => {
    const result=mutationQueue.then(work);mutationQueue=result.then(()=>{},()=>{});return result;
  };

  let broadcastAt = -Infinity;
  const sendEncoded = (socket: ServerWebSocket<SocketData>, message: string): void => {
    if (socket.getBufferedAmount() > 1024 * 1024) { socket.close(1013, 'SLOW_CLIENT'); return; }
    socket.send(message);
  };
  const send = (socket: ServerWebSocket<SocketData>, message: unknown): void => sendEncoded(socket, JSON.stringify(message));
  const offChat=vcChat.observe(state=>{const message=JSON.stringify({type:'vc-chat',state});for(const socket of clients)if(socket.data.chat)sendEncoded(socket,message);});
  const snapshot = (state=engine.snapshot(now())): unknown => {const playback=options.replay?.status();return {type:'snapshot',state:{...state,clockRate:playback?(playback.paused||playback.seeking?0:playback.rate):1}};};
  const broadcast = (): void => {
    const state=engine.snapshot(now());
    journal.state(state);
    const message = JSON.stringify(snapshot(state));
    for (const socket of clients) sendEncoded(socket, message);
    broadcastAt = performance.now();
  };
  const context={options,now,settings,studioStore,customAssets,presets,avatars,recording,vcChat,diagnostic,broadcast,serial};
  const routes=[statusRoutes(context),assetRoutes(context),commandRoute(context)];
  const server = Bun.serve<SocketData>({
    hostname: '127.0.0.1', port: options.port, maxRequestBodySize: MAX_STUDIO_UNPACKED_BYTES + 1024*1024,
    async fetch(request, server) {
      if (!validHost(request, server.port!)) return json({ error: 'HOST_REJECTED' }, 403);
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        if (request.method !== 'GET' || !validOrigin(request, server.port!)) return json({ error: 'ORIGIN_REJECTED' }, 403);
        if (clients.size >= 8) return json({ error: 'CLIENT_LIMIT' }, 429);
        return server.upgrade(request, { data: { messages: 0, windowStart: performance.now() } }) ? undefined : json({ error: 'UPGRADE_REQUIRED' }, 400);
      }
      for(const route of routes){const response=await route(request,url,server.port!);if(response)return response;}
      if (request.method === 'GET' && url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
      if (request.method === 'GET' && url.pathname === '/') return Response.redirect(`http://127.0.0.1:${server.port}/dock`, 302);
      const asset = options.assets[url.pathname];
      if (request.method === 'GET' && asset) return new Response(asset.encoding==='base64'?Buffer.from(asset.body,'base64'):asset.body, { headers: headers(asset.type) });
      return json({ error: 'NOT_FOUND' }, 404);
    },
    websocket: {
      maxPayloadLength: 1024 * 1024, backpressureLimit: 1024 * 1024, closeOnBackpressureLimit: true,
      open(socket) {
        if (clients.size >= 8) { socket.close(1013, 'CLIENT_LIMIT'); return; }
        clients.add(socket);
        send(socket, { type: 'hello' });
        send(socket, snapshot());
      },
      message(socket, message) {
        try {
          const time = performance.now();
          if (time - socket.data.windowStart > 1000) { socket.data.windowStart = time; socket.data.messages = 0; }
          if (++socket.data.messages > 30) { socket.close(1008, 'MESSAGE_RATE_LIMIT'); return; }
          if (typeof message !== 'string') throw new Error();
          const p = JSON.parse(message) as Record<string,unknown>;
          if (p.type === 'ping' && typeof p.clientTime === 'number' && Number.isFinite(p.clientTime)) send(socket, { type: 'pong', clientTime: p.clientTime, serverTime: now() });
          else if(p.type==='vc-chat-subscribe'){socket.data.chat=true;send(socket,{type:'vc-chat',state:vcChat.snapshot()});}
          else if(p.type==='render-status'){
            const allowed=['READY','STUDIO_LOADING','STUDIO_LOAD_FAILED','STUDIO_CAPACITY_OVERFLOW','CAMERA_SAFE_FALLBACK','CUSTOM_AVATAR_UNAVAILABLE','WEBGL_CONTEXT_LOST'];
            if(!allowed.includes(String(p.status))||![p.frameMs,p.drawCalls,p.triangles].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1e9))throw new Error();
            const exposure=typeof p.exposure==='number'&&Number.isFinite(p.exposure)&&p.exposure>0&&p.exposure<=32&&['AUTO','MANUAL','EMPTY_METER','HDR_UNAVAILABLE','METER_FAILED'].includes(String(p.exposureStatus))&&typeof p.authoredLights==='number'&&Number.isSafeInteger(p.authoredLights)&&p.authoredLights>=0&&p.authoredLights<=10000&&typeof p.fallbackLights==='boolean'?{exposure:p.exposure,exposureStatus:String(p.exposureStatus),authoredLights:p.authoredLights,fallbackLights:p.fallbackLights}:{};
            const quality=['DIRECT','EFFECTS','EFFECTS_UNAVAILABLE','EFFECTS_FAILED'].includes(String(p.qualityStatus))&&typeof p.shadowLights==='number'&&Number.isInteger(p.shadowLights)&&p.shadowLights>=0&&p.shadowLights<=8?{qualityStatus:String(p.qualityStatus),shadowLights:p.shadowLights}:{};
            reports.set(socket,{status:String(p.status),frameMs:p.frameMs as number,drawCalls:p.drawCalls as number,triangles:p.triangles as number,updatedAtMs:performance.now(),...exposure,...quality,...(typeof p.msaaSamples==='number'&&[0,2,4,8].includes(p.msaaSamples)?{msaaSamples:p.msaaSamples}:{})});
          }
          else if (p.type === 'resync') send(socket, snapshot());
          else socket.close(1008, 'INVALID_MESSAGE');
        } catch { socket.close(1008, 'INVALID_MESSAGE'); }
      },
      close(socket) { clients.delete(socket); reports.delete(socket); },
    },
    error() { return json({ error: 'INTERNAL_ERROR' }, 500); },
  });
  const timer = setInterval(() => {
    if (options.tick) options.tick(); else engine.tick(now());
    if (performance.now() - broadcastAt >= 95) broadcast();
  }, 50);
  return {
    server, broadcast,
    urls: { overlay: `http://127.0.0.1:${server.port}/overlay`, dock: `http://127.0.0.1:${server.port}/dock` },
    async stop() { offEvents(); offChat(); clearInterval(timer); for (const socket of clients) socket.close(1001, 'SHUTDOWN'); await server.stop(true); },
  };
}
