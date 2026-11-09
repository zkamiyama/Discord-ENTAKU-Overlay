import {VcChatFeed} from '../src/chat/vc-chat-feed.ts';
import { AppEngine } from '../src/domain/engine.ts';
import { startServer } from '../src/server/app.ts';
import { demoEvents } from '../src/replay/demo.ts';
const start=performance.now();
const engine=new AppEngine({source:'demo',serverEpoch:'e2e-only'});
for(const event of demoEvents())engine.apply(event);
// This entry point never reads Discord or persistent user data.
const vcChat=new VcChatFeed('unavailable');
const app=startServer({vcChat,engine,assets:await Bun.file('.generated/web-assets.json').json(),port:31339,now:()=>performance.now()-start});
// Synthetic chat controller exists only in this E2E entry point, never in the app.
let controller:ReturnType<typeof Bun.serve>|undefined;
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
const stop=()=>{void controller?.stop(true);void app.stop().then(()=>process.exit(0));};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
