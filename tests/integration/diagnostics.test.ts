import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {startServer} from '../../src/server/app.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {parseReplay} from '../../src/replay/player.ts';
const keys={read:'1'.repeat(64),control:'2'.repeat(64)};
test('diagnostics and event exports require control access and never expose capabilities or Discord names',async()=>{
 let clock=100;const engine=new AppEngine({source:'demo',serverEpoch:'test'});for(const e of demoEvents())engine.apply(e);
 const app=startServer({engine,keys,assets:{},port:0,now:()=>clock});const origin=`http://127.0.0.1:${app.server.port}`;
 const headers={Origin:origin,Authorization:`Bearer ${keys.control}`,'Content-Type':'application/json'};
 const command=(type:string)=>fetch(origin+'/api/commands',{method:'POST',headers,body:JSON.stringify({type,requestId:crypto.randomUUID(),expectedRevision:engine.snapshot().revision})});
 try{
  expect((await fetch(origin+'/api/diagnostics',{headers:{Authorization:`Bearer ${keys.read}`}})).status).toBe(403);
  expect((await command('record-start')).status).toBe(200);expect((await command('record-start')).status).toBe(422);
  const user=engine.snapshot().participants[0]!;clock=500;
  engine.apply({type:'speaking',userId:user.userId,state:'active',sourceGeneration:1,receivedAtMs:500});
  clock=2500;engine.tick(clock);expect((await command('record-stop')).status).toBe(200);
  const text=await (await fetch(origin+'/api/replay/export',{headers})).text();expect(parseReplay(text).events.length).toBeGreaterThan(2);expect(text).not.toContain(user.displayName);
  const report=await (await fetch(origin+'/api/diagnostics',{headers})).text();expect(report).not.toContain(keys.read);expect(report).not.toContain(keys.control);expect(report).not.toContain(user.displayName);
  expect(JSON.parse(report).recording.active).toBe(false);
 }finally{await app.stop();}
});
