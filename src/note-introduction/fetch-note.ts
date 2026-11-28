import type {IntroducedNote,NoteIntroductionSettings} from '../contracts/note-introduction.ts';
import {MISSKEY_MAX_INPUT_UNITS,staticMfmText,validMisskeyId} from '../misskey/moderation.ts';

export interface NoteIntroductionDependencies {
  fetch:typeof fetch;
  now():number;
  setTimeout(callback:()=>void,delay:number):unknown;
  clearTimeout(handle:unknown):void;
}
export interface NoteTarget {id:string;url:string;instanceUrl:string}
export type FetchedNote=Omit<IntroducedNote,'presentationId'|'sourceMessageId'|'sourceChannelId'|'introducedBy'>;
export const NOTE_INTRODUCTION_FETCH_LIMITS=Object.freeze({responseBytes:1024*1024,timeoutMs:10_000,intervalMs:1000,maxAutomaticRetryMs:3_600_000,textUnits:32768});
export class NoteIntroductionFailure extends Error {
  constructor(readonly code:string,readonly retryAt:number|null=null){super(code);}
}
const fail=(code:string):never=>{throw new NoteIntroductionFailure(`NOTE_INTRODUCTION_${code}`);};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Extract only configured origins. No URL supplied in Discord is itself fetched. */
export function lastNoteTarget(content:string,instances:readonly string[]):NoteTarget|null {
  if(typeof content!=='string'||content.length>4000)return null;
  let found:NoteTarget|null=null;
  for(const match of content.matchAll(/https:\/\/[^\s<>"'`]+/giu)){
    const raw=match[0].replace(/[.,!?;:、。！，？；：)\]}>）］｝」』】〉》|]+$/gu,'');
    // URL normalisation must not turn userinfo, a port, backslashes or encoded
    // authorities into an apparently allowlisted origin.
    const authority=/^https:\/\/([^/]+)/i.exec(raw)?.[1];
    if(!authority||/[:@%\\]/.test(authority)||/[\\\p{Cc}\p{Cf}]/u.test(raw))continue;
    try{
      const url=new URL(raw),note=/^\/notes\/([A-Za-z0-9_-]{1,128})$/.exec(raw.slice(8+authority.length));
      if(url.protocol!=='https:'||!instances.includes(url.origin)||url.username||url.password||url.port||url.search||url.hash||!note)continue;
      found={id:note[1]!,instanceUrl:url.origin,url:`${url.origin}/notes/${note[1]}`};
    }catch{/* Unrelated or malformed text is not a request. */}
  }
  return found;
}

function guardedNote(value:unknown,includeHome:boolean):Record<string,unknown> {
  if(!record(value)||!validMisskeyId(value.id)||!record(value.user)||!validMisskeyId(value.user.id))return fail('INVALID_NOTE');
  const flags=[value.isHidden,value.hidden,value.isSensitive,value.sensitive,value.user.requireSigninToViewContents,value.user.isSuspended];
  if(flags.some(flag=>flag!==undefined&&typeof flag!=='boolean')||value.visibleUserIds!==undefined&&!Array.isArray(value.visibleUserIds))return fail('INVALID_NOTE');
  if(value.visibility!=='public'&&!(includeHome&&value.visibility==='home')||value.isHidden===true||value.hidden===true||
    value.user.requireSigninToViewContents===true||value.user.isSuspended===true||Array.isArray(value.visibleUserIds)&&value.visibleUserIds.length)return fail('NOT_PUBLIC');
  if(value.cw!=null||value.isSensitive===true||value.sensitive===true)return fail('SENSITIVE');
  if(value.channel!=null){if(!record(value.channel)||value.channel.isSensitive!==undefined&&typeof value.channel.isSensitive!=='boolean')return fail('INVALID_NOTE');if(value.channel.isSensitive===true)return fail('SENSITIVE');}
  if(value.files!==undefined&&(!Array.isArray(value.files)||value.files.length>64))return fail('INVALID_NOTE');
  if(Array.isArray(value.files))for(const file of value.files){
    if(!record(file)||file.isSensitive!==undefined&&typeof file.isSensitive!=='boolean')return fail('INVALID_NOTE');if(file.isSensitive===true)return fail('SENSITIVE');
  }
  return value;
}
function plain(value:unknown,limit=MISSKEY_MAX_INPUT_UNITS,preserveWhitespace=true):string {
  if(typeof value!=='string'||value.length>limit)return fail('INVALID_NOTE');
  try{return staticMfmText(value,{preserveWhitespace});}catch{return fail('INVALID_NOTE');}
}
function author(value:unknown):{userId:string;username:string;authorName:string;userHost:string|null} {
  if(!record(value)||!validMisskeyId(value.id)||typeof value.username!=='string'||!/^[A-Za-z0-9_]{1,128}$/.test(value.username)||
    value.name!=null&&(typeof value.name!=='string'||value.name.length>512)||
    value.host!=null&&(typeof value.host!=='string'||value.host.length>253||!value.host||!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(value.host)))return fail('INVALID_NOTE');
  const authorName=value.name?plain(value.name,512,false):value.username;
  if(authorName.length>512)return fail('INVALID_NOTE');
  return {userId:value.id,username:value.username,authorName:authorName||value.username,userHost:typeof value.host==='string'?value.host:null};
}
function assertTextBudget(note:Record<string,unknown>):void {
  let units=0;
  const consume=(value:unknown):void=>{
    if(value==null)return;if(typeof value!=='string')return fail('INVALID_NOTE');
    units+=value.length;if(units>NOTE_INTRODUCTION_FETCH_LIMITS.textUnits)return fail('INVALID_NOTE');
  };
  const visit=(current:Record<string,unknown>,depth:number):void=>{
    consume(current.text);if(record(current.user))consume(current.user.name);
    if(current.poll!=null){
      if(!record(current.poll)||!Array.isArray(current.poll.choices)||!current.poll.choices.length||current.poll.choices.length>32)return fail('INVALID_NOTE');
      for(const choice of current.poll.choices){if(!record(choice))return fail('INVALID_NOTE');consume(choice.text);}
    }
    if(current.renote!=null){if(depth>=1||!record(current.renote))return fail('INVALID_NOTE');visit(current.renote,depth+1);}
  };
  visit(note,0);
}
function noteText(note:Record<string,unknown>,includeHome:boolean,depth=0):string {
  const body=note.text==null?'':plain(note.text),parts=body?[body]:[];
  if(note.poll!=null){
    if(!record(note.poll)||!Array.isArray(note.poll.choices)||!note.poll.choices.length||note.poll.choices.length>32)return fail('INVALID_NOTE');
    parts.push('アンケート\n'+note.poll.choices.map((choice,index)=>{
      if(!record(choice))return fail('INVALID_NOTE');return `${index+1}. ${plain(choice.text)}`;
    }).join('\n'));
  }
  if(note.renote!=null){
    if(depth>=1)return fail('INVALID_NOTE');
    const quoted=guardedNote(note.renote,includeHome),name=author(quoted.user).authorName,text=noteText(quoted,includeHome,depth+1);
    const attachments=Array.isArray(quoted.files)?quoted.files.length:0;
    parts.push(`引用：${name}\n${text}${attachments?`${text?'\n':''}添付 ${attachments}件`:''}`);
  }
  const text=parts.join('\n\n');if(text.length>32768)return fail('INVALID_NOTE');return text;
}
export function normalizeIntroducedNote(value:unknown,target:NoteTarget,settings:NoteIntroductionSettings):FetchedNote {
  const note=guardedNote(value,settings.includeHome);
  if(note.id!==target.id||typeof note.createdAt!=='string'||note.createdAt.length>40||!Number.isFinite(Date.parse(note.createdAt)))return fail('INVALID_NOTE');
  assertTextBudget(note);
  const metadata=author(note.user),text=noteText(note,settings.includeHome),attachmentCount=Array.isArray(note.files)?note.files.length:0;
  if(!text.trim()&&!attachmentCount)return fail('EMPTY');
  return {...target,...metadata,text,createdAt:new Date(note.createdAt).toISOString(),attachmentCount};
}
function retryAfter(response:Response,now:number):number {
  const header=response.headers.get('retry-after');let delay=60_000;
  if(header!==null&&header.length<=128){
    const parsed=/^\d+(?:\.\d+)?$/.test(header.trim())?Number(header)*1000:Date.parse(header)-now;
    if(Number.isFinite(parsed))delay=parsed;
  }
  // Retain the server's deadline. A long wait must not become an early retry.
  return Math.min(8_640_000_000_000_000,Math.ceil(now+Math.max(1000,delay)));
}
async function boundedJson(response:Response,signal:AbortSignal):Promise<unknown> {
  const length=response.headers.get('content-length');
  if(length!==null){if(!/^\d{1,12}$/.test(length)||!Number.isSafeInteger(Number(length)))return fail('INVALID_NOTE');if(Number(length)>NOTE_INTRODUCTION_FETCH_LIMITS.responseBytes)return fail('RESPONSE_TOO_LARGE');}
  const type=response.headers.get('content-type');
  if(!type||type.length>256||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type)||!response.body)return fail('INVALID_NOTE');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{
    signal.throwIfAborted();
    for(;;){const result=await reader.read();signal.throwIfAborted();if(result.done)break;size+=result.value.length;
      if(size>NOTE_INTRODUCTION_FETCH_LIMITS.responseBytes)return fail('RESPONSE_TOO_LARGE');chunks.push(result.value);}
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail('INVALID_NOTE');}
}
/** Anonymous POST only. Redirects, cookies, media and remote note URLs are never
 * followed; response size and the entire body read share one deadline. */
export async function fetchIntroducedNote(target:NoteTarget,settings:NoteIntroductionSettings,signal:AbortSignal,deps:NoteIntroductionDependencies):Promise<FetchedNote> {
  const checked=lastNoteTarget(target.url,settings.instances);
  if(!checked||checked.url!==target.url||checked.instanceUrl!==target.instanceUrl||checked.id!==target.id)return fail('INVALID_NOTE');
  const controller=new AbortController();let timedOut=false,response:Response|undefined;
  const abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timeout=deps.setTimeout(()=>{timedOut=true;controller.abort();},NOTE_INTRODUCTION_FETCH_LIMITS.timeoutMs);
  let onAbort:(()=>void)|undefined;
  const cancelled=new Promise<never>((_resolve,reject)=>{
    onAbort=()=>reject(new NoteIntroductionFailure(timedOut?'NOTE_INTRODUCTION_TIMEOUT':'NOTE_INTRODUCTION_UNAVAILABLE'));
    controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();
  });
  const request=async():Promise<FetchedNote>=>{
    controller.signal.throwIfAborted();
    response=await deps.fetch(`${target.instanceUrl}/api/notes/show`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({noteId:target.id}),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
    // A transport may resolve after the deadline even when it ignores Abort.
    // The outer race has already settled, so release this late body here.
    if(controller.signal.aborted){if(response.body&&!response.body.locked)void response.body.cancel().catch(()=>{});controller.signal.throwIfAborted();}
    controller.signal.throwIfAborted();
    if(response.status===429)throw new NoteIntroductionFailure('NOTE_INTRODUCTION_RATE_LIMITED',retryAfter(response,deps.now()));
    if(response.status===404)return fail('NOT_FOUND');if(response.status===401||response.status===403)return fail('NOT_PUBLIC');
    if(!response.ok){
      let error:unknown;try{error=await boundedJson(response,controller.signal);}catch{return fail('UNAVAILABLE');}
      const code=record(error)&&record(error.error)?error.error.code:null;
      if(code==='NO_SUCH_NOTE')return fail('NOT_FOUND');
      if(code==='CONTENT_RESTRICTED_BY_USER'||code==='CONTENT_RESTRICTED_BY_SERVER'||code==='CREDENTIAL_REQUIRED')return fail('NOT_PUBLIC');
      if(code==='RATE_LIMIT_EXCEEDED')throw new NoteIntroductionFailure('NOTE_INTRODUCTION_RATE_LIMITED',retryAfter(response,deps.now()));
      return fail('UNAVAILABLE');
    }
    return normalizeIntroducedNote(await boundedJson(response,controller.signal),target,settings);
  };
  try{return await Promise.race([request(),cancelled]);}
  catch(error){if(error instanceof NoteIntroductionFailure)throw error;throw new NoteIntroductionFailure(timedOut?'NOTE_INTRODUCTION_TIMEOUT':'NOTE_INTRODUCTION_UNAVAILABLE');}
  finally{
    deps.clearTimeout(timeout);signal.removeEventListener('abort',abort);if(onAbort)controller.signal.removeEventListener('abort',onAbort);
    if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});
  }
}
