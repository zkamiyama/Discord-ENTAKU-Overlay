import { expect, test } from 'bun:test';
import {StateReceiver} from '../../src/contracts/state-stream.ts';
import { AppEngine } from '../../src/domain/engine.ts';
import { startServer } from '../../src/server/app.ts';
import { demoEvents } from '../../src/replay/demo.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {SettingsStore} from '../../src/storage/settings-store.ts';
// DOM typings omit Bun's documented client-header extension. This test runs in Bun.
const BunWebSocket=WebSocket as unknown as {new(url:string,options:{headers:Record<string,string>}):WebSocket};
function setup() {
  const engine=new AppEngine({source:'demo',serverEpoch:'test'});
  for(const e of demoEvents())engine.apply(e);
  const app=startServer({engine,assets:{'/dock':{body:'dock',type:'text/html'},'/overlay':{body:'overlay',type:'text/html'}},port:0,now:()=>0});
  return {engine,app,origin:`http://127.0.0.1:${app.server.port}`};
}
test('local pages and APIs need no key, but Host and Origin restrictions remain',async()=>{
  const {app,origin}=setup();
  try{
    expect((await fetch(origin+'/dock')).status).toBe(200);
    expect((await fetch(origin+'/overlay')).status).toBe(200);
    expect((await fetch(origin+'/deck')).status).toBe(404);
    expect((await fetch(origin+'/api/health',{headers:{Host:'evil.example'}})).status).toBe(403);
    const command={type:'mode',mode:'HOLD',requestId:'request-1',expectedRevision:0};
    const post=(body:unknown,from?:string)=>fetch(origin+'/api/commands',{method:'POST',headers:{...(from?{Origin:from}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
    expect((await post(command)).status).toBe(403);
    expect((await post(command,'https://evil.example')).status).toBe(403);
    const success=await post(command,origin);expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ok:true,revision:1});
    expect((await post(command,origin)).status).toBe(200);
    expect((await post({...command,requestId:'request-2'},origin)).status).toBe(409);
    expect((await fetch(origin+'/api/diagnostics')).status).toBe(200);
  }finally{await app.stop();}
});
test('WebSocket connects without auth and rejects a foreign Origin',async()=>{
  const {app,origin}=setup(),messages:Record<string,unknown>[]=[];
  const ws=new BunWebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Origin:origin}});
  ws.onmessage=e=>messages.push(JSON.parse(String(e.data)));
  try{
    await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('WS_OPEN_FAILED'));});
    const until=performance.now()+2000;
    while(!messages.some(m=>m.type==='snapshot')&&performance.now()<until)await Bun.sleep(5);
    expect(messages[0]).toEqual({type:'hello'});
    expect(messages[1]?.type).toBe('snapshot');
    expect(JSON.stringify(messages)).toContain('アオイ');
    ws.send(JSON.stringify({type:'ping',clientTime:123}));
    const pongUntil=performance.now()+1000;
    while(!messages.some(m=>m.type==='pong')&&performance.now()<pongUntil)await Bun.sleep(5);
    expect(messages.some(m=>m.type==='pong')).toBe(true);
    const invalid=new BunWebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Origin:'https://evil.example'}});
    try{
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('ORIGIN_CHECK_TIMEOUT')),1500);
        invalid.onclose=()=>{clearTimeout(timer);resolve();};
        invalid.onerror=()=>{clearTimeout(timer);resolve();};
        invalid.onopen=()=>{clearTimeout(timer);reject(new Error('ORIGIN_WAS_ACCEPTED'));};
      });
    }finally{invalid.close();}
  }finally{ws.close();await app.stop();}
});

test('live sockets receive ordered state deltas and can request an independent full snapshot',async()=>{
 const {engine,app,origin}=setup(),receiver=new StateReceiver();
 const ws=new BunWebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Origin:origin}});
 const messages:any[]=[];let rejected=0;
 ws.onmessage=e=>{
  const m=JSON.parse(String(e.data));messages.push(m);
  if(m.type==='snapshot'||m.type==='snapshot-delta')if(!receiver.accept(m))rejected++;
 };
 const until=async(predicate:()=>boolean)=>{
  const end=performance.now()+3000;
  while(!predicate()&&performance.now()<end)await Bun.sleep(5);
  expect(predicate()).toBe(true);
 };
 try{
  await until(()=>messages.some(m=>m.type==='snapshot'));
  engine.control({type:'mode',mode:'HOLD'},engine.currentRevision,0);app.broadcast();
  await until(()=>messages.some(m=>m.type==='snapshot-delta'&&m.changes.mode==='HOLD'));
  ws.send(JSON.stringify({type:'resync'}));
  await until(()=>messages.filter(m=>m.type==='snapshot').length>=2);
  expect(messages.filter(m=>m.type==='snapshot').at(-1)?.state.mode).toBe('HOLD');
  expect(rejected).toBe(0);
 }finally{ws.close();await app.stop();}
});

test('server shutdown is idempotent and retired publishers cannot emit new work',async()=>{
 const {app}=setup();
 const stopping=app.stop();expect(app.stop()).toBe(stopping);
 await stopping;expect(()=>app.broadcast()).not.toThrow();expect(app.stop()).toBe(stopping);
});

test('a native server stop failure still drains the already running settings transaction',async()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'stop-failure'}),studios=new StudioStore();
 for(const event of demoEvents())engine.apply(event);
 let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const validate=studios.validateDraft.bind(studios);
 studios.validateDraft=async input=>{entered();await gate;return validate(input);};
 const app=startServer({engine,studioStore:studios,assets:{},port:0,now:()=>100}),origin=`http://127.0.0.1:${app.server.port}`;
 const nativeStop=app.server.stop.bind(app.server);
 app.server.stop=async force=>{await nativeStop(force);throw new Error('INJECTED_STOP_FAILURE');};
 const request=fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({type:'studio-reset',requestId:'drain',expectedRevision:0})}).catch(error=>error);
 try{
  await started;
  let finished=false;const stopping=app.stop().catch(error=>error);void stopping.then(()=>{finished=true;});
  await Bun.sleep(0);expect(finished).toBe(false);
  release();expect(await stopping).toMatchObject({message:'INJECTED_STOP_FAILURE'});
  expect(engine.currentRevision).toBe(1);await request;
 }finally{release();await nativeStop(true);}
});

for(const [code,status] of [['SETTINGS_CONFLICT',409],['SETTINGS_WRITE_FAILED',500]] as const){
 test(`HTTP ${code} reports ${status} and preserves the previous runtime generation`,async()=>{
  const engine=new AppEngine({source:'demo',serverEpoch:'settings-error'}),store=new SettingsStore();
  for(const event of demoEvents())engine.apply(event);
  store.commit=()=>{throw new Error(code);};
  const app=startServer({engine,settingsStore:store,assets:{},port:0,now:()=>100}),origin=`http://127.0.0.1:${app.server.port}`;
  const before=engine.snapshot();
  try{
   const response=await fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({type:'studio-set',scene:{...before.studio,tableAnchor:{position:[1,0,0],yawDeg:20}},requestId:'settings-error',expectedRevision:before.revision})});
   expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
   expect(engine.currentRevision).toBe(before.revision);expect(engine.snapshot().studio).toEqual(before.studio);expect(store.generation).toBe(0);
  }finally{await app.stop();}
 });
}
