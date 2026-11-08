import { DiagnosticJournal } from '../diagnostics/journal.ts';
import { ProviderRecording } from '../diagnostics/recording.ts';
import type { RenderReport,ReplayControl,ReplayStatus,RuntimeDiagnostics } from '../contracts/diagnostics.ts';
import { StudioStore, unpackStudioZip } from '../studio/store.ts';
import { DEFAULT_STUDIO_SCENE, MAX_STUDIO_UNPACKED_BYTES } from '../studio/manifest.ts';
import { VERSION } from '../version.ts';
import { AvatarStore } from '../assets/store.ts';
import { MAX_IMAGE_BYTES } from '../assets/image.ts';
import type { ServerWebSocket } from 'bun';
import { AppEngine } from '../domain/engine.ts';
import { validHost, validOrigin } from './security.ts';
import { AvatarCache } from './avatar-cache.ts';
import type { DirectorMode, ProviderEvent } from '../contracts/domain.ts';
import { demoParticipant } from '../replay/demo.ts';
export interface WebAsset { body: string; type: string; encoding?: 'base64' }
export type WebAssets = Record<string, WebAsset>;
interface SocketData { messages: number; windowStart: number }
export interface ServerOptions {
  engine: AppEngine; assets: WebAssets; port: number;
  now?: () => number; tick?: () => void; onChange?: () => void;
  retry?: () => void;
  avatarStore?: AvatarStore;
  studioStore?: StudioStore;
  replay?:{status:()=>ReplayStatus;control:(command:ReplayControl)=>Promise<void>};
}
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; connect-src 'self' blob: data:; img-src 'self' blob: data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
function headers(type = 'application/json'): Record<string,string> {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };
}
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: headers() }); }
export function startServer(options: ServerOptions) {
  const { engine } = options;
  const now = options.now ?? (() => performance.now());
  const clients = new Set<ServerWebSocket<SocketData>>();
  const journal=new DiagnosticJournal(),recording=new ProviderRecording();
  const reports=new Map<ServerWebSocket<SocketData>,RenderReport>();
  const offEvents=engine.observeEvents((event,ms)=>{journal.event(event,ms);recording.append(event,ms);});
  const diagnostic=():RuntimeDiagnostics=>{
    const state=engine.snapshot(now()),render=[...reports.values()].filter(r=>performance.now()-r.updatedAtMs<10000).sort((a,b)=>b.updatedAtMs-a.updatedAtMs)[0]??null;
    return {version:VERSION,runtime:Bun.version,platform:process.platform,source:state.source,connection:state.connection,errorCode:state.errorCode,participantCount:state.participants.filter(p=>p.presence==='present').length,capacity:state.session.capacity,rssBytes:process.memoryUsage().rss,events:journal.snapshot(),render,recording:recording.info(now()),replay:options.replay?.status()??null};
  };
  const replies = new Map<string, { body: string; result: unknown }>();
  const avatars = new AvatarCache();
  const studioStore=options.studioStore??new StudioStore();
  const customAssets = options.avatarStore ?? new AvatarStore();
  let mutationQueue = Promise.resolve();
  const serial = <T>(work:()=>Promise<T>):Promise<T> => {
    const result=mutationQueue.then(work);mutationQueue=result.then(()=>{},()=>{});return result;
  };
  const assetErrors = new Set(['IMAGE_TOO_LARGE','IMAGE_DIMENSIONS_REJECTED','INVALID_IMAGE','ANIMATED_IMAGE_REJECTED','IMAGE_FORMAT_REJECTED','ASSET_STORE_FULL','ASSET_NOT_FOUND','INVALID_AVATAR_PROFILE','INVALID_FACE_RECT','INVALID_FRAMING_RECT','FRAMING_MUST_INCLUDE_FACE','FACE_RECT_TOO_SMALL','INVALID_AVATAR_TRANSFORM','AVATAR_TOO_WIDE','AVATAR_TOO_TALL','AVATAR_SETTINGS_WRITE_FAILED','TOO_MANY_AVATAR_PROFILES']);
  let demoId = 1000, broadcastAt = -Infinity;
  const send = (socket: ServerWebSocket<SocketData>, message: unknown): void => {
    if (socket.getBufferedAmount() > 1024 * 1024) { socket.close(1013, 'SLOW_CLIENT'); return; }
    socket.send(JSON.stringify(message));
  };
  const snapshot = (): unknown => {const playback=options.replay?.status();return {type:'snapshot',state:{...engine.snapshot(now()),clockRate:playback?(playback.paused||playback.seeking?0:playback.rate):1}};};
  const broadcast = (): void => {
    journal.state(engine.snapshot(now()));
    const message = snapshot();
    for (const socket of clients) send(socket, message);
    broadcastAt = performance.now();
  };
  const applyDemo = (event: ProviderEvent): void => { engine.apply(event, now()); options.onChange?.(); };
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
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ application: 'Discord ENTAKU Overlay', version: VERSION, protocolVersion: 1 });
      if(request.method==='GET'&&url.pathname==='/api/diagnostics'){
        return json(diagnostic());
      }
      if(request.method==='GET'&&url.pathname==='/api/replay/export'){
        try{return new Response(recording.export(now()),{headers:headers('application/x-ndjson; charset=utf-8')});}
        catch{return json({error:'RECORDING_EMPTY'},422);}
      }
      if (request.method === 'GET' && url.pathname === '/api/studio/bundles') {
        try{return json(await studioStore.list());}catch{return json({error:'STUDIO_INDEX_UNAVAILABLE'},500);}
      }
      const bundleMatch=/^\/api\/studio\/bundles\/([a-f0-9]{64})(\/file)?$/.exec(url.pathname);
      if(request.method==='GET'&&bundleMatch){
        try{
          if(!bundleMatch[2])return json(await studioStore.bundle(bundleMatch[1]!));
          const file=await studioStore.file(bundleMatch[1]!,url.searchParams.get('path')??'');
          return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]),{headers:headers(file.mime)});
        }catch{return json({error:'STUDIO_FILE_NOT_FOUND'},404);}
      }
      if(request.method==='POST'&&url.pathname==='/api/studio/import'){
        if(!validOrigin(request,server.port!))return json({error:'ORIGIN_REJECTED'},403);
        return serial(async()=>{
          try{
            const form=await request.formData(),entry=form.get('entry');
            if(entry!==null&&typeof entry!=='string')throw new Error('STUDIO_ENTRY_REQUIRED');
            const archive=form.get('archive');
            let files;
            if(archive instanceof File){files=unpackStudioZip(new Uint8Array(await archive.arrayBuffer()));}
            else{
              const inputs=[...form.entries()].filter(([name])=>name.startsWith('file:'));
              if(inputs.length>256)throw new Error('STUDIO_FILE_LIMIT');
              files=await Promise.all(inputs.map(async([name,value])=>{
                const file:unknown=value;
                if(!(file instanceof File))throw new Error('STUDIO_FILE_REJECTED');
                return {path:name.slice(5),bytes:new Uint8Array(await file.arrayBuffer())};
              }));
            }
            return json(await studioStore.importFiles(files,entry||undefined),201);
          }catch(e){const code=e instanceof Error&&/^STUDIO_[A-Z_]+$/.test(e.message)?e.message:'STUDIO_IMPORT_FAILED';return json({error:code},422);}
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/assets') {
        if (!validOrigin(request,server.port!)) return json({error:'ORIGIN_REJECTED'},403);
        if (!['image/png','image/webp'].includes(request.headers.get('content-type')??'')) return json({error:'IMAGE_FORMAT_REJECTED'},415);
        if(Number(request.headers.get('content-length')??0)>MAX_IMAGE_BYTES)return json({error:'IMAGE_TOO_LARGE'},413);
        return serial(async()=>{
          try { const data=new Uint8Array(await request.arrayBuffer());return json(await customAssets.importImage(data),201); }
          catch(e){const code=e instanceof Error&&assetErrors.has(e.message)?e.message:'ASSET_IMPORT_FAILED';return json({error:code},code==='IMAGE_TOO_LARGE'?413:422);}
        });
      }
      const customMatch=/^\/api\/assets\/([a-f0-9]{64})$/.exec(url.pathname);
      if(request.method==='GET'&&customMatch){
        try{const {info,bytes}=await customAssets.get(customMatch[1]!);return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]),{headers:headers(info.mime)});}
        catch{return json({error:'ASSET_NOT_FOUND'},404);}
      }
      if (request.method === 'POST' && url.pathname === '/api/commands') {
        if (!validOrigin(request, server.port!)) return json({ error: 'ORIGIN_REJECTED' }, 403);
                if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
        return serial(async()=>{
        try {
          const raw = await request.text(); if (Buffer.byteLength(raw) > 256*1024) return json({ error: 'COMMAND_TOO_LARGE' }, 413);
          const body: unknown = JSON.parse(raw);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_COMMAND');
          const c = body as Record<string,unknown>;
          if (typeof c.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.requestId) || !Number.isSafeInteger(c.expectedRevision)) throw new Error('INVALID_COMMAND');
          const prior = replies.get(c.requestId);
          if (prior) return prior.body === raw ? json(prior.result) : json({ error: 'REQUEST_ID_CONFLICT' }, 409);
          if (c.expectedRevision !== engine.snapshot().revision) return json({ error: 'REVISION_CONFLICT', revision: engine.snapshot().revision }, 409);
          const current = now();
          if(c.type==='record-start')recording.start(engine.snapshot(now()));
          else if(c.type==='record-stop')recording.stop(now());
          else if(c.type==='replay-control'&&options.replay){
            if(!['play','pause','seek','rate'].includes(String(c.action)))throw new Error('INVALID_COMMAND');
            if((c.action==='seek'||c.action==='rate')&&(typeof c.value!=='number'||!Number.isFinite(c.value)))throw new Error('INVALID_COMMAND');
            await options.replay.control({action:c.action as ReplayControl['action'],value:c.value as number|undefined});
          } else if(c.type==='studio-set'||c.type==='studio-reset'){
            const scene=await studioStore.save(c.type==='studio-reset'?DEFAULT_STUDIO_SCENE:c.scene);
            engine.setStudioScene(scene,c.expectedRevision as number,now());
          } else if(c.type==='avatar-set'){
            const profile=await customAssets.validateDraft(c.profile);
            const profiles=[...engine.snapshot().avatarProfiles.filter(p=>p.userId!==profile.userId),profile];
            await customAssets.saveProfiles(profiles);
            engine.setAvatarProfiles(profiles,c.expectedRevision as number,now());
          } else if(c.type==='avatar-reset'&&typeof c.userId==='string'&&/^\d{1,20}$/.test(c.userId)){
            const profiles=engine.snapshot().avatarProfiles.filter(p=>p.userId!==c.userId);
            await customAssets.saveProfiles(profiles);engine.setAvatarProfiles(profiles,c.expectedRevision as number,now());
          } else if (c.type === 'mode' && ['AUTO','MANUAL','HOLD'].includes(String(c.mode))) engine.control({ type: 'mode', mode: c.mode as DirectorMode }, c.expectedRevision as number, current);
          else if(c.type==='moderators'&&Array.isArray(c.userIds)&&c.userIds.every(id=>typeof id==='string'))engine.control({type:'moderators',userIds:c.userIds as string[]},c.expectedRevision as number,current);
          else if (c.type === 'wide') engine.control({ type: 'shot', shot: { kind: 'WIDE', userIds: [] } }, c.expectedRevision as number, current);
          else if (c.type === 'single' && typeof c.userId === 'string') engine.control({ type: 'shot', shot: { kind: 'SINGLE', userIds: [c.userId] } }, c.expectedRevision as number, current);
          else if (c.type === 'release' && typeof c.userId === 'string' && c.confirm === true) engine.control({ type: 'release', userId: c.userId }, c.expectedRevision as number, current);
          else if (c.type === 'new-session' && c.confirm === true) engine.control({ type: 'new-session' }, c.expectedRevision as number, current);
          else if (c.type === 'retry' && options.retry) options.retry();
          else if (engine.snapshot().source === 'demo' && c.type === 'demo-add') {
            const occupied = new Set([
              ...engine.snapshot().participants.map(p => p.userId),
              ...engine.sessions().flatMap(s => [...s.reservations.map(r => r.userId), ...s.waitingUserIds]),
            ]);
            while (occupied.has(String(++demoId))) { /* Do not reuse a restored reservation. */ }
            const id = String(demoId);
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
          const code = error instanceof Error && (/^STUDIO_[A-Z_]+$/.test(error.message) || assetErrors.has(error.message) || ['INVALID_COMMAND','TARGET_NOT_PRESENT','CANNOT_RELEASE_PRESENT_USER','RESERVATION_NOT_FOUND','NO_CHANNEL','MEMBERSHIP_UNCONFIRMED','INVALID_MODERATORS','CANNOT_RECORD_REPLAY','RECORDING_ALREADY_ACTIVE','INVALID_REPLAY_TIME','INVALID_REPLAY_RATE'].includes(error.message)) ? error.message : 'COMMAND_REJECTED';
          return json({ error: code }, 422);
        }
        });
      }
      const avatarMatch = /^\/api\/avatars\/(\d{1,20})$/.exec(url.pathname);
      if (request.method === 'GET' && avatarMatch) {
        const person = engine.snapshot().participants.find(p => p.userId === avatarMatch[1]);
        if (!person?.avatarUrl) return json({ error: 'AVATAR_NOT_FOUND' }, 404);
        try { const data = await avatars.get(person.avatarUrl); return new Response(new Blob([data as Uint8Array<ArrayBuffer>]), { headers: headers('image/png') }); }
        catch { return json({ error: 'AVATAR_UNAVAILABLE' }, 502); }
      }
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
          else if(p.type==='render-status'){
            const allowed=['READY','STUDIO_LOADING','STUDIO_LOAD_FAILED','STUDIO_CAPACITY_OVERFLOW','CAMERA_SAFE_FALLBACK','CUSTOM_AVATAR_UNAVAILABLE','WEBGL_CONTEXT_LOST'];
            if(!allowed.includes(String(p.status))||![p.frameMs,p.drawCalls,p.triangles].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1e9))throw new Error();
            const exposure=typeof p.exposure==='number'&&Number.isFinite(p.exposure)&&p.exposure>0&&p.exposure<=32&&['AUTO','MANUAL','EMPTY_METER','HDR_UNAVAILABLE','METER_FAILED'].includes(String(p.exposureStatus))&&typeof p.authoredLights==='number'&&Number.isSafeInteger(p.authoredLights)&&p.authoredLights>=0&&p.authoredLights<=10000&&typeof p.fallbackLights==='boolean'?{exposure:p.exposure,exposureStatus:String(p.exposureStatus),authoredLights:p.authoredLights,fallbackLights:p.fallbackLights}:{};
            const quality=['DIRECT','EFFECTS','EFFECTS_UNAVAILABLE','EFFECTS_FAILED'].includes(String(p.qualityStatus))&&typeof p.shadowLights==='number'&&Number.isInteger(p.shadowLights)&&p.shadowLights>=0&&p.shadowLights<=4?{qualityStatus:String(p.qualityStatus),shadowLights:p.shadowLights}:{};
            reports.set(socket,{status:String(p.status),frameMs:p.frameMs as number,drawCalls:p.drawCalls as number,triangles:p.triangles as number,updatedAtMs:performance.now(),...exposure,...quality});
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
    async stop() { offEvents(); clearInterval(timer); for (const socket of clients) socket.close(1001, 'SHUTDOWN'); await server.stop(true); },
  };
}
