import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {startServer} from '../../src/server/app.ts';
import {VcChatFeed} from '../../src/chat/vc-chat-feed.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {capturePreset} from '../../src/presets/schema.ts';
const BunWS=WebSocket as unknown as {new(url:string,options:{headers:Record<string,string>}):WebSocket};
const until=async(p:()=>boolean)=>{const limit=performance.now()+2000;while(!p()){if(performance.now()>limit)throw Error('CHAT_WS_TIMEOUT');await Bun.sleep(5);}};
test('Dock receives chat on a separate subscription and API; overlay, diagnostics, recordings and presets never include it',async()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'chat-test'});for(const e of demoEvents())engine.apply(e);
 const feed=new VcChatFeed(),handlers=new Set<(p:any)=>void>(),rpc={onEvent:(f:(p:any)=>void)=>{handlers.add(f);return()=>{handlers.delete(f);};},request:async(_cmd:string,_args:unknown,evt?:string)=>({evt})};
 const app=startServer({engine,assets:{},vcChat:feed,port:0,now:()=>1000}),origin=`http://127.0.0.1:${app.server.port}`;
 const dock:any[]=[],overlay:any[]=[],ws=new BunWS(origin.replace('http:','ws:')+'/ws',{headers:{Origin:origin}}),display=new BunWS(origin.replace('http:','ws:')+'/ws',{headers:{Origin:origin}});
 ws.onmessage=e=>dock.push(JSON.parse(String(e.data)));display.onmessage=e=>overlay.push(JSON.parse(String(e.data)));
 const command=(type:string)=>fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({type,requestId:crypto.randomUUID(),expectedRevision:engine.snapshot().revision})});
 try{
  await until(()=>dock.some(m=>m.type==='hello')&&overlay.some(m=>m.type==='hello'));ws.send(JSON.stringify({type:'vc-chat-subscribe'}));await until(()=>dock.some(m=>m.type==='vc-chat'));
  await command('record-start');await feed.start(rpc,{id:'200',type:2,name:'Synthetic VC'});
  for(const h of handlers)h({cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:'200',message:{id:'500',author:{id:'42',username:'CHAT_PRIVATE_AUTHOR'},content:'CHAT_PRIVATE_BODY',timestamp:new Date().toISOString()}}});
  await until(()=>dock.some(m=>m.type==='vc-chat'&&m.state.messages.length===1));await command('record-stop');
  const response=await fetch(origin+'/api/vc-chat');expect(response.headers.get('cache-control')).toBe('no-store');expect((await response.json()).messages[0].content).toBe('CHAT_PRIVATE_BODY');
  await Bun.sleep(150);expect(JSON.stringify(overlay)).not.toMatch(/CHAT_PRIVATE|vc-chat/);expect(JSON.stringify(dock.filter(m=>m.type==='snapshot'))).not.toContain('CHAT_PRIVATE');
  expect(await (await fetch(origin+'/api/diagnostics')).text()).not.toContain('CHAT_PRIVATE');expect(await (await fetch(origin+'/api/replay/export')).text()).not.toContain('CHAT_PRIVATE');
  expect(JSON.stringify(capturePreset(engine.snapshot(),'dark'))).not.toContain('CHAT_PRIVATE');
  feed.disconnect();await until(()=>dock.at(-1)?.type==='vc-chat'&&dock.at(-1).state.status==='disconnected'||dock.some(m=>m.type==='vc-chat'&&m.state.status==='disconnected'));
  expect(feed.snapshot().messages).toEqual([]);
 }finally{ws.close();display.close();await app.stop();}
});
