import {VERSION} from '../../version.ts';
import {json,headers} from '../http.ts';
import type {RouteContext,HttpRoute} from './context.ts';
export function statusRoutes(context:RouteContext):HttpRoute {
 const {vcChat,diagnostic,recording,presets,now}=context;
 return async(request,url)=>{
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ application: 'Discord ENTAKU Overlay', version: VERSION, protocolVersion: 1 });
      if(request.method==='GET'&&url.pathname==='/api/vc-chat')return json(vcChat.snapshot());
      if(request.method==='GET'&&url.pathname==='/api/diagnostics'){
        return json(diagnostic());
      }
      if(request.method==='GET'&&url.pathname==='/api/replay/export'){
        try{return new Response(recording.export(now()),{headers:headers('application/x-ndjson; charset=utf-8')});}
        catch{return json({error:'RECORDING_EMPTY'},422);}
      }
      if(request.method==='GET'&&url.pathname==='/api/presets'){
        try{return json({items:await presets.list()});}catch{return json({error:'PRESET_INDEX_UNAVAILABLE'},500);}
      }
 };
}
