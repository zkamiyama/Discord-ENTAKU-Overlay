import {VcChatFeed} from '../src/chat/vc-chat-feed.ts';
import { AppEngine } from '../src/domain/engine.ts';
import { startServer } from '../src/server/app.ts';
import { demoEvents } from '../src/replay/demo.ts';
import {MisskeyFeed} from '../src/misskey/feed.ts';
import {DEFAULT_MISSKEY_SETTINGS} from '../src/misskey/settings.ts';
import {SettingsStore} from '../src/storage/settings-store.ts';
import {defaultSettings} from '../src/storage/settings-schema.ts';
import {NoteIntroductionFeed} from '../src/note-introduction/feed.ts';
const start=performance.now();
const engine=new AppEngine({source:'demo',serverEpoch:'e2e-only'});
for(const event of demoEvents())engine.apply(event);
// This entry point never reads Discord or persistent user data.
const vcChat=new VcChatFeed('unavailable');
const syntheticMisskey=process.env.ENTAKU_E2E_MISSKEY==='1';
let misskeyClock=Date.now()-20_000,misskeyId=0;
const misskeySettings={...DEFAULT_MISSKEY_SETTINGS,enabled:syntheticMisskey,lifetimeMs:120_000};
const misskey=new MisskeyFeed(misskeySettings,syntheticMisskey?()=>misskeyClock:Date.now);
const settingsStore=new SettingsStore(null,{...defaultSettings(),misskey:misskeySettings});
const syntheticIntroductions=process.env.ENTAKU_E2E_NOTE_INTRODUCTION==='1';
const introductionNotes=new Map<string,{note:unknown;delayMs:number;status:number;headers:Record<string,string>}>();
const introductionRequests:Array<{id:string;url:string;at:number}>=[];
const noteIntroduction=syntheticIntroductions?new NoteIntroductionFeed(settingsStore.snapshot().noteIntroduction,{
 fetch:(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const {noteId}=JSON.parse(String(init?.body)),fixture=introductionNotes.get(noteId);
  introductionRequests.push({id:String(noteId),url:String(input),at:performance.now()});
  // Deliberately ignore abort here, so browser tests can exercise stale results.
  if(fixture?.delayMs)await Bun.sleep(fixture.delayMs);
  return Response.json(fixture?.note??{id:noteId,user:{id:'note-author',username:'creator',name:'映像実験室'},
   visibility:'public',cw:null,files:[],createdAt:'2026-11-28T00:00:00.000Z',text:`音と映像が重なる、この瞬間が好き。 #NicoMiss (${noteId})`},
   {status:fixture?.status??200,headers:fixture?.headers??{}});
 }) as typeof fetch,
}):undefined;
if(syntheticMisskey)misskey.setConnection('live');
const app=startServer({vcChat,engine,misskey,misskeyStream:null,noteIntroduction,settingsStore,assets:await Bun.file('.generated/web-assets.json').json(),port:31339,now:()=>performance.now()-start});
// Synthetic chat controller exists only in this E2E entry point, never in the app.
let controller:ReturnType<typeof Bun.serve>|undefined;
let misskeyController:ReturnType<typeof Bun.serve>|undefined;
let introductionController:ReturnType<typeof Bun.serve>|undefined;
if(syntheticIntroductions){
 introductionController=Bun.serve({hostname:'127.0.0.1',port:31342,maxRequestBodySize:128*1024,async fetch(request){
  if(request.method==='GET')return Response.json({requests:introductionRequests,state:noteIntroduction!.snapshot()});
  if(request.method!=='POST')return new Response('',{status:405});
  const data=await request.json();
  if(data.action!=='seed'||typeof data.id!=='string')return Response.json({error:'FIXTURE_REQUEST_INVALID'},{status:422});
  introductionNotes.set(data.id,{note:data.note??{id:data.id,user:{id:'note-author',username:'creator',name:'映像実験室'},visibility:'public',cw:null,
   files:[],createdAt:'2026-11-28T00:00:00.000Z',text:data.text??'合成ノート'},delayMs:Math.max(0,Math.min(8000,Number(data.delayMs)||0)),status:data.status??200,headers:data.headers??{}});
  return Response.json({ok:true});
 }});
}
if(syntheticMisskey){
 misskeyController=Bun.serve({hostname:'127.0.0.1',port:31341,maxRequestBodySize:65536,async fetch(request){
  if(request.method!=='POST')return new Response('',{status:405});const data=await request.json();
  if(data.action==='seed'){
   const count=Math.min(100,Math.max(1,Number(data.count)||1));
   for(let i=0;i<count;i++){
    misskeyClock+=500;const id=String(++misskeyId);
    misskey.ingest({id,user:{id:'user'+id,username:'guest_'+id,name:['音楽と映像','Geometry Nodes','映像実験室','ENTAKUの視聴者'][i%4]},
     visibility:'public',createdAt:new Date(misskeyClock).toISOString(),cw:null,tags:['nicomiss'],files:[],
     text:data.text??`#NicoMiss ${['この瞬間の音と映像が好き。次の展開も楽しみ！','画面の奥に言葉が浮かんで、みんなで観ている感じがする。','今日の作品もすごい。細かいところまで見返したくなる。','色もリズムもぴったり。新しい表現にわくわくします。'][i%4]} ${id}`});
    misskey.tick();
   }
  }else if(data.action==='note'){misskey.ingest(data.note);misskeyClock+=250;misskey.tick();}
  else if(data.action==='delete')misskey.remove(String(data.id));
  else if(data.action==='edit')misskey.update(String(data.id),{text:data.text,cw:null});
  else if(data.action==='live')misskey.setConnection('live');
  else if(data.action==='disconnect'){misskey.clear();misskey.setConnection('reconnecting');}
  return Response.json({ok:true,state:misskey.snapshot()});
 }});
}
if(process.env.ENTAKU_E2E_CHAT==='1'){
 const listeners=new Set<(p:Record<string,unknown>)=>void>();
 const rpc={onEvent:(f:(p:Record<string,unknown>)=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};},request:async(_cmd:string,_args:unknown,evt?:string)=>({evt})};
 await vcChat.start(rpc,{id:'200',name:'テストVC',type:2});
 controller=Bun.serve({hostname:'127.0.0.1',port:31340,maxRequestBodySize:65536,async fetch(request){
  if(request.method!=='POST')return new Response('',{status:405});const data=await request.json();
  if(data.action==='move')await vcChat.start(rpc,{id:data.channelId,name:'別のテストVC',type:2});
  else if(data.action==='disconnect')vcChat.disconnect();
  else for(const listener of listeners)listener(data);
  return Response.json({ok:true});
 }});
}
console.log('ENTAKU_E2E_READY');
const stop=()=>{void controller?.stop(true);void misskeyController?.stop(true);void introductionController?.stop(true);void app.stop().then(()=>process.exit(0));};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
