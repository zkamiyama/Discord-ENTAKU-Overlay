import { expect, test } from 'bun:test';
import { AppEngine } from '../../src/domain/engine.ts';
import { startServer } from '../../src/server/app.ts';
import { demoEvents } from '../../src/replay/demo.ts';
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
