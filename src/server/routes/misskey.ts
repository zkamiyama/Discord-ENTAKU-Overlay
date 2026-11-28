import {boundedText} from '../bounded-body.ts';
import {validOrigin} from '../security.ts';
import {json} from '../http.ts';
import type {RouteContext,HttpRoute} from './context.ts';

/** Local Dock writes share the server's same-origin restrictions. */
export function misskeyRoutes(context:RouteContext):HttpRoute {
  const {settings,misskey,misskeyStream,serial}=context;
  return async(request,url,port)=>{
    if(request.method==='GET'&&url.pathname==='/api/misskey')return json(misskey.snapshot());
    if(request.method==='GET'&&url.pathname==='/api/misskey/settings')return json(settings.misskey());
    if(request.method!=='POST'||!['/api/misskey/settings','/api/misskey/control'].includes(url.pathname))return;
    if(!validOrigin(request,port))return json({error:'ORIGIN_REJECTED'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON_REQUIRED'},415);
    let input:Record<string,unknown>;
    try{input=JSON.parse(await boundedText(request,32768));if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();}
    catch{return json({error:'MISSKEY_REQUEST_INVALID'},422);}
    return serial(async()=>{
      try{
        if(url.pathname==='/api/misskey/settings'){
          if(Object.keys(input).some(key=>!['settings','generation'].includes(key))||!Number.isSafeInteger(input.generation)||Number(input.generation)<0)throw new Error('MISSKEY_REQUEST_INVALID');
          // Commit first. A failed save must leave the old connection intact.
          const result=settings.setMisskey(input.settings,Number(input.generation));
          misskey.configure(result.settings);misskeyStream?.configure(result.settings);
          return json(result);
        }
        if(input.action==='clear'&&Object.keys(input).length===1)misskey.clear();
        else if(input.action==='pause'&&typeof input.paused==='boolean'&&Object.keys(input).length===2)misskey.setPaused(input.paused);
        else throw new Error('MISSKEY_REQUEST_INVALID');
        return json({ok:true,state:misskey.snapshot()});
      }catch(error){
        const code=error instanceof Error&&/^(MISSKEY|SETTINGS)_[A-Z_]+$/.test(error.message)?error.message:'MISSKEY_REQUEST_INVALID';
        return json({error:code},code.endsWith('_CONFLICT')?409:code.endsWith('_WRITE_FAILED')?500:422);
      }
    },request.signal);
  };
}
