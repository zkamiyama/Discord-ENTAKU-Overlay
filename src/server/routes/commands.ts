import {parseCommand} from '../../contracts/commands.ts';
import type {DirectorMode,ProviderEvent} from '../../contracts/domain.ts';
import type {ReplayControl} from '../../contracts/diagnostics.ts';
import {capturePreset,type Theme} from '../../presets/schema.ts';
import {DEFAULT_STUDIO_SCENE} from '../../studio/manifest.ts';
import {demoParticipant} from '../../replay/demo.ts';
import {validOrigin} from '../security.ts';
import {json,assetErrors} from '../http.ts';
import type {RouteContext,HttpRoute} from './context.ts';
export function commandRoute(context:RouteContext):HttpRoute {
 const {options,now,settings,presets,recording,broadcast,serial}=context;
 const {engine}=options;
 const replies=new Map<string,{body:string;result:unknown}>();let demoId=1000;
 const applyDemo=(event:ProviderEvent)=>{engine.apply(event,now());options.onChange?.();};
 return async(request,url,port)=>{
      if (request.method === 'POST' && url.pathname === '/api/commands') {
        if (!validOrigin(request, port)) return json({ error: 'ORIGIN_REJECTED' }, 403);
                if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
        return serial(async()=>{
        try {
          const raw = await request.text(); if (Buffer.byteLength(raw) > 256*1024) return json({ error: 'COMMAND_TOO_LARGE' }, 413);
          const c = parseCommand(JSON.parse(raw));
          const prior = replies.get(c.requestId);
          if (prior) return prior.body === raw ? json(prior.result) : json({ error: 'REQUEST_ID_CONFLICT' }, 409);
          if (c.expectedRevision !== engine.snapshot().revision) return json({ error: 'REVISION_CONFLICT', revision: engine.snapshot().revision }, 409);
          const current = now();let extra:Record<string,unknown>={};
          if(c.type==='preset-save'){
            const preset=capturePreset(engine.snapshot(),c.theme as Theme);
            extra={presetName:await presets.create(c.name as string,preset),presetSignature:JSON.stringify(preset)};
          }else if(c.type==='preset-apply'&&typeof c.name==='string'){
            extra=await settings.preset(c.name,c.expectedRevision as number);
          }else if(c.type==='record-start')recording.start(engine.snapshot(now()));
          else if(c.type==='record-stop')recording.stop(now());
          else if(c.type==='replay-control'&&options.replay){
            if(!['play','pause','seek','rate'].includes(String(c.action)))throw new Error('INVALID_COMMAND');
            if((c.action==='seek'||c.action==='rate')&&(typeof c.value!=='number'||!Number.isFinite(c.value)))throw new Error('INVALID_COMMAND');
            await options.replay.control({action:c.action as ReplayControl['action'],value:c.value as number|undefined});
          } else if(c.type==='studio-set'||c.type==='studio-reset'){
            await settings.scene(c.type==='studio-reset'?DEFAULT_STUDIO_SCENE:c.scene,c.expectedRevision as number);
          } else if(c.type==='avatar-set'){
            await settings.avatar(c.profile,c.expectedRevision as number);
          } else if(c.type==='avatar-reset'&&typeof c.userId==='string'&&/^\d{1,20}$/.test(c.userId)){
            await settings.resetAvatar(c.userId,c.expectedRevision as number);
          } else if (c.type === 'mode' && ['AUTO','MANUAL','HOLD'].includes(String(c.mode))) engine.control({ type: 'mode', mode: c.mode as DirectorMode }, c.expectedRevision as number, current);
          else if(c.type==='seat-move'&&typeof c.userId==='string'&&Number.isInteger(c.slotIndex))engine.control({type:'seat-move',userId:c.userId,slotIndex:c.slotIndex as number},c.expectedRevision as number,current);
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
          } else if (engine.snapshot().source === 'demo' && (c.type==='demo-speaking'||c.type==='demo-presence')) {
            const person = engine.snapshot().participants.find(p => p.userId === c.userId);
            if (!person) throw new Error('TARGET_NOT_PRESENT');
            if (c.type === 'demo-speaking' && typeof c.active === 'boolean') applyDemo({ type: 'speaking', userId: person.userId, state: c.active ? 'active' : 'inactive', sourceGeneration: 1, receivedAtMs: current });
            else if (c.type === 'demo-presence' && typeof c.present === 'boolean') applyDemo(c.present
              ? { type: 'participant-upsert', participant: person, sourceGeneration: 1, receivedAtMs: current }
              : { type: 'participant-left', userId: person.userId, sourceGeneration: 1, receivedAtMs: current });
            else throw new Error('INVALID_COMMAND');
          } else throw new Error('INVALID_COMMAND');
          options.onChange?.(); broadcast();
          const result = { requestId: c.requestId, revision: engine.snapshot().revision, ok: true,...extra };
          if (replies.size >= 256) replies.delete(replies.keys().next().value!);
          replies.set(c.requestId, { body: raw, result }); return json(result);
        } catch (error) {
          const code = error instanceof Error && (/^(STUDIO|PRESET|SETTINGS|GAUSSIAN)_[A-Z0-9_]+$/.test(error.message) || assetErrors.has(error.message) || ['REVISION_CONFLICT','INVALID_COMMAND','TARGET_NOT_PRESENT','CANNOT_RELEASE_PRESENT_USER','RESERVATION_NOT_FOUND','INVALID_SEAT_TARGET','NO_CHANNEL','MEMBERSHIP_UNCONFIRMED','INVALID_MODERATORS','CANNOT_RECORD_REPLAY','RECORDING_ALREADY_ACTIVE','INVALID_REPLAY_TIME','INVALID_REPLAY_RATE'].includes(error.message)) ? error.message : 'COMMAND_REJECTED';
          return json({ error: code }, code==='REVISION_CONFLICT'?409:422);
        }
        });
      }
 };
}
