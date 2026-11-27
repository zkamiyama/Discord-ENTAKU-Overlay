import {parseRenderReport} from './render-report.ts';
import {StatePublisher} from '../contracts/state-stream.ts';
import {WorkQueue} from './work-queue.ts';
import {GAUSSIAN_LIMITS} from '../assets/gaussian-profile.ts';
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
interface SocketData { chat?:boolean; messages: number; windowStart: number; frame?:number }
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
  // The single writer protects cross-store transactions; bounded admission also
  // protects the process from retaining unlimited uploaded assets or commands.
  const mutations=new WorkQueue(8);
  let stopping=false,stopped:Promise<void>|undefined;
  const serial = async(work:()=>Promise<Response>,signal?:AbortSignal):Promise<Response> => {
    const result=mutations.tryRun(work,signal);
    if(!result)return json({error:stopping?'SERVER_STOPPING':'SERVER_BUSY'},503);
    try{return await result;}catch(error){
      if(error instanceof Error&&error.message==='WORK_CANCELLED')return json({error:signal?.aborted?'REQUEST_CANCELLED':'SERVER_STOPPING'},503);
      throw error;
    }
  };

  let broadcastAt = -Infinity;
  const stream=new StatePublisher();
  const closeSocket=(socket:ServerWebSocket<SocketData>,code:number,reason:string):void=>{
    clients.delete(socket);reports.delete(socket);
    if(!clients.size)stream.reset();
    try{socket.close(code,reason);}catch{/* A failed connection cannot interrupt another client or a committed command. */}
  };
  const sendEncoded = (socket: ServerWebSocket<SocketData>, message: string): boolean => {
    if(stopping||!clients.has(socket))return false;
    try{
      if(socket.getBufferedAmount()<=1024*1024&&socket.send(message)!==0)return true;
    }catch{/* Retire only the failing socket. */}
    closeSocket(socket,1013,'SLOW_CLIENT');return false;
  };
  const send = (socket: ServerWebSocket<SocketData>, message: unknown): void => {sendEncoded(socket, JSON.stringify(message));};
  const offChat=vcChat.observe(state=>{const message=JSON.stringify({type:'vc-chat',state});for(const socket of clients)if(socket.data.chat)sendEncoded(socket,message);});
  const broadcast = (): void => {
    if(stopping)return;
    const time=now();
    if(clients.size){
      const state=engine.snapshot(time),playback=options.replay?.status();journal.state(state);
      const packet=stream.publish({...state,clockRate:playback?(playback.paused||playback.seeking?0:playback.rate):1});
      for(const socket of clients){
        const message=socket.data.frame===packet.base&&packet.delta!==undefined?packet.delta:packet.full();
        socket.data.frame=sendEncoded(socket,message)?packet.frame:undefined;
      }
    }else journal.state(engine.journalState(time));
    broadcastAt=performance.now();
  };
  const sendFull=(socket:ServerWebSocket<SocketData>):void=>{
    const packet=stream.latest;
    if(!packet){broadcast();return;}
    socket.data.frame=sendEncoded(socket,packet.full())?packet.frame:undefined;
  };
  const context={options,now,settings,studioStore,customAssets,presets,avatars,recording,vcChat,diagnostic,broadcast,serial};
  const routes=[statusRoutes(context),assetRoutes(context),commandRoute(context)];
  const server = Bun.serve<SocketData>({
    hostname: '127.0.0.1', port: options.port, maxRequestBodySize: Math.max(MAX_STUDIO_UNPACKED_BYTES,GAUSSIAN_LIMITS.unpackedBytes) + 1024*1024,
    async fetch(request, server) {
      if(stopping)return json({error:'SERVER_STOPPING'},503);
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
        if(stopping){closeSocket(socket,1001,'SHUTDOWN');return;}
        if (clients.size >= 8) { closeSocket(socket,1013,'CLIENT_LIMIT');return; }
        clients.add(socket);
        send(socket, { type: 'hello' });
        // Initial snapshots are full and current. Established sockets receive
        // the same new wire frame as a delta, keeping one baseline globally.
        broadcast();
      },
      message(socket, message) {
        if(stopping||!clients.has(socket))return;
        try {
          const time = performance.now();
          if (time - socket.data.windowStart > 1000) { socket.data.windowStart = time; socket.data.messages = 0; }
          if (++socket.data.messages > 30) { socket.close(1008, 'MESSAGE_RATE_LIMIT'); return; }
          if (typeof message !== 'string') throw new Error();
          const p = JSON.parse(message) as Record<string,unknown>;
          if (p.type === 'ping' && typeof p.clientTime === 'number' && Number.isFinite(p.clientTime)) send(socket, { type: 'pong', clientTime: p.clientTime, serverTime: now() });
          else if(p.type==='vc-chat-subscribe'){socket.data.chat=true;send(socket,{type:'vc-chat',state:vcChat.snapshot()});}
          else if(p.type==='render-status'){
            reports.set(socket,parseRenderReport(p,performance.now()));
          }
          else if (p.type === 'resync') sendFull(socket);
          else socket.close(1008, 'INVALID_MESSAGE');
        } catch { socket.close(1008, 'INVALID_MESSAGE'); }
      },
      close(socket) { clients.delete(socket); reports.delete(socket);if(!clients.size)stream.reset(); },
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
    stop():Promise<void> {
      return stopped??=(async()=>{
        stopping=true;offEvents();offChat();clearInterval(timer);
        const drained=mutations.close();
        for(const socket of clients)closeSocket(socket,1001,'SHUTDOWN');
        await server.stop(true);await drained;
      })();
    },
  };
}
