import {boundedText} from '../bounded-body.ts';
import {validOrigin} from '../security.ts';
import {json} from '../http.ts';
import type {RouteContext,HttpRoute} from './context.ts';

/** Same-origin controls; settings commit before reconfiguring the live feed. */
export function noteIntroductionRoutes(context:RouteContext):HttpRoute {
  const {settings,noteIntroduction,serial}=context;
  return async(request,url,port)=>{
    if(request.method==='GET'&&url.pathname==='/api/note-introduction')return json(noteIntroduction.snapshot());
    if(request.method==='GET'&&url.pathname==='/api/note-introduction/settings')return json(settings.noteIntroduction());
    if(request.method!=='POST'||!['/api/note-introduction/settings','/api/note-introduction/control'].includes(url.pathname))return;
    if(!validOrigin(request,port))return json({error:'ORIGIN_REJECTED'},403);
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))return json({error:'JSON_REQUIRED'},415);
    let input:Record<string,unknown>;
    try{
      input=JSON.parse(await boundedText(request,32768));
      if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();
    }catch{return json({error:'NOTE_INTRODUCTION_REQUEST_INVALID'},422);}
    const apply=async()=>{
      try{
        if(url.pathname.endsWith('/settings')){
          if(Object.keys(input).some(key=>!['settings','generation'].includes(key))||!Number.isSafeInteger(input.generation)||Number(input.generation)<0)throw new Error('NOTE_INTRODUCTION_REQUEST_INVALID');
          const result=settings.setNoteIntroduction(input.settings,Number(input.generation));
          noteIntroduction.configure(result.settings);
          return json(result);
        }
        if(input.action!=='dismiss'||Object.keys(input).some(key=>!['action','revision'].includes(key))||!Number.isSafeInteger(input.revision)||Number(input.revision)<0)throw new Error('NOTE_INTRODUCTION_REQUEST_INVALID');
        if(input.revision!==noteIntroduction.snapshot().revision)throw new Error('NOTE_INTRODUCTION_CONFLICT');
        noteIntroduction.dismiss();return json({ok:true,state:noteIntroduction.snapshot()});
      }catch(error){
        const code=error instanceof Error&&/^(NOTE_INTRODUCTION|SETTINGS)_[A-Z_0-9]+$/.test(error.message)?error.message:'NOTE_INTRODUCTION_REQUEST_INVALID';
        return json({error:code},code.endsWith('_CONFLICT')?409:code.endsWith('_WRITE_FAILED')?500:422);
      }
    };
    // Ending a broadcast is synchronous and must remain responsive during a
    // large asset import. Only durable settings writes enter the writer queue.
    return url.pathname.endsWith('/control')?apply():serial(apply,request.signal);
  };
}
