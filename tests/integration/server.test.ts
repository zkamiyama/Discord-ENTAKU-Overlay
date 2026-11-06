import { expect, test } from 'bun:test';
// DOM typings omit Bun's documented client-header extension. This test runs in Bun.
const BunWebSocket = WebSocket as unknown as { new(url: string, options: { headers: Record<string,string> }): WebSocket };
import { AppEngine } from '../../src/domain/engine.ts';
import { startServer } from '../../src/server/app.ts';
import { newAccessKeys } from '../../src/server/security.ts';
import { demoEvents } from '../../src/replay/demo.ts';
function setup() {
  const engine = new AppEngine({ source: 'demo', serverEpoch: 'test' });
  for (const e of demoEvents()) engine.apply(e);
  const keys = newAccessKeys();
  const app = startServer({ engine, keys, assets: { '/dock': { body: 'dock', type: 'text/html' }, '/overlay': { body: 'overlay', type: 'text/html' } }, port: 0, now: () => 0 });
  return { engine, keys, app, origin: `http://127.0.0.1:${app.server.port}` };
}
test('local routes enforce Host, Origin, separate capabilities and revision conflicts', async () => {
  const { app, origin, keys } = setup();
  try {
    expect((await fetch(origin+'/dock')).status).toBe(200);
    expect((await fetch(origin+'/deck')).status).toBe(404);
    expect((await fetch(origin+'/api/health',{headers:{Host:'evil.example'}})).status).toBe(403);
    const command={type:'mode',mode:'HOLD',requestId:'request-1',expectedRevision:0};
    const post=(key:string,body:unknown,from=origin)=>fetch(origin+'/api/commands',{method:'POST',headers:{Origin:from,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    expect((await post(keys.read,command)).status).toBe(403);
    expect((await post(keys.control,command,'https://evil.example')).status).toBe(403);
    const success=await post(keys.control,command);expect(success.status).toBe(200);expect(await success.json()).toMatchObject({ok:true,revision:1});
    expect((await post(keys.control,command)).status).toBe(200); // Idempotent retry.
    expect((await post(keys.control,{...command,requestId:'request-2'})).status).toBe(409);
    const health=await (await fetch(origin+'/api/health')).text();expect(health).not.toContain('アオイ');expect(health).not.toContain(keys.control);
  } finally { await app.stop(); }
});
test('WebSocket sends no state before auth; read key cannot obtain control bootstrap', async () => {
  const {app,origin,keys}=setup();
  const messages:Record<string,unknown>[]=[];
  const ws=new BunWebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Origin:origin}});
  try {
    await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('WS_OPEN_FAILED'));});
    ws.onmessage=e=>messages.push(JSON.parse(String(e.data)));
    await new Promise(resolve=>setTimeout(resolve,30));expect(messages).toHaveLength(0);
    ws.send(JSON.stringify({type:'auth',key:keys.read}));
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WS_TIMEOUT')),2000);const poll=setInterval(()=>{if(messages.some(m=>m.type==='snapshot')){clearTimeout(timer);clearInterval(poll);resolve();}},5);});
    expect(messages[0]).toMatchObject({type:'hello',role:'read'});expect(messages[0]).not.toHaveProperty('overlayUrl');
    expect(JSON.stringify(messages)).not.toContain(keys.control);
    expect(JSON.stringify(messages)).toContain('アオイ');
  } finally {ws.close();await app.stop();}
});
