import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppEngine} from '../../src/domain/engine.ts';
import {startServer} from '../../src/server/app.ts';
import {MisskeyFeed} from '../../src/misskey/feed.ts';
import {DEFAULT_MISSKEY_SETTINGS} from '../../src/misskey/settings.ts';
import {SettingsStore} from '../../src/storage/settings-store.ts';
import {defaultSettings} from '../../src/storage/settings-schema.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {capturePreset} from '../../src/presets/schema.ts';

const until=async(predicate:()=>boolean)=>{const limit=performance.now()+3000;while(!predicate()){if(performance.now()>limit)throw Error('MISSKEY_TEST_TIMEOUT');await Bun.sleep(5);}};
const BunWS=WebSocket as unknown as {new(url:string,options:{headers:Record<string,string>}):WebSocket};
function note(id='1'){return {id,user:{id:'u'+id,username:'user_'+id,name:'Synthetic author'},visibility:'public',text:'MISSKEY_PUBLIC_BODY '+id+' #NicoMiss',tags:['nicomiss'],createdAt:new Date().toISOString(),cw:null,files:[]};}
function fixture(store?:SettingsStore){
 const engine=new AppEngine({source:'demo',serverEpoch:'misskey-test'});for(const e of demoEvents())engine.apply(e);
 const settingsStore=store??new SettingsStore(null,{...defaultSettings(),misskey:{...DEFAULT_MISSKEY_SETTINGS,enabled:true}});
 const feed=new MisskeyFeed(settingsStore.snapshot().misskey);feed.setConnection('live');
 const app=startServer({engine,assets:{},misskey:feed,misskeyStream:null,settingsStore,port:0,now:()=>1000}),origin=`http://127.0.0.1:${app.server.port}`;
 const post=(path:string,data:unknown,from=origin)=>fetch(origin+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(data)});
 return {engine,settingsStore,feed,app,origin,post};
}
test('Misskey is an independently subscribed bounded feed, absent from voice state, diagnostics and presets',async()=>{
 const f=fixture(),packets:any[]=[],other:any[]=[];
 const ws=new BunWS(f.origin.replace('http:','ws:')+'/ws',{headers:{Origin:f.origin}}),idle=new BunWS(f.origin.replace('http:','ws:')+'/ws',{headers:{Origin:f.origin}});
 ws.onmessage=e=>packets.push(JSON.parse(String(e.data)));idle.onmessage=e=>other.push(JSON.parse(String(e.data)));
 try{
  await until(()=>packets.some(m=>m.type==='hello')&&other.some(m=>m.type==='hello'));
  ws.send(JSON.stringify({type:'misskey-subscribe'}));await until(()=>packets.some(m=>m.type==='misskey'));
  f.feed.ingest(note());await until(()=>packets.some(m=>m.type==='misskey'&&m.state.cards.length===1));
  const response=await fetch(f.origin+'/api/misskey');expect(response.headers.get('cache-control')).toBe('no-store');expect((await response.json()).cards).toHaveLength(1);
  expect(JSON.stringify(packets.filter(m=>m.type==='snapshot'||m.type==='snapshot-delta'))).not.toContain('MISSKEY_PUBLIC_BODY');
  expect(JSON.stringify(other)).not.toContain('MISSKEY_PUBLIC_BODY');expect(await (await fetch(f.origin+'/api/diagnostics')).text()).not.toContain('MISSKEY_PUBLIC_BODY');
  expect(JSON.stringify(capturePreset(f.engine.snapshot(),'dark'))).not.toContain('MISSKEY_PUBLIC_BODY');
  f.feed.update('1',{text:'changed'});await until(()=>packets.filter(m=>m.type==='misskey').at(-1).state.cards.length===0);
 }finally{ws.close();idle.close();await f.app.stop();}
});
test('Misskey settings use durable generations, enforce Origin and preserve previous settings on write failure',async()=>{
 const f=fixture();
 try{
  const before=await (await fetch(f.origin+'/api/misskey/settings')).json();
  expect((await f.post('/api/misskey/settings',before,'https://untrusted.example')).status).toBe(403);
  const settings={...before.settings,hashtag:'#Next',maxCards:12,includeHome:true};
  const saved=await f.post('/api/misskey/settings',{settings,generation:before.generation});expect(saved.status).toBe(200);
  const result=await saved.json();expect(result.settings.hashtag).toBe('Next');expect(f.feed.settings.includeHome).toBe(true);
  expect((await f.post('/api/misskey/settings',{settings,generation:before.generation})).status).toBe(409);
  expect((await f.post('/api/misskey/settings',{settings:{...settings,instanceUrl:'https://127.0.0.1'},generation:result.generation})).status).toBe(422);
  const commit=f.settingsStore.commit.bind(f.settingsStore);f.settingsStore.commit=()=>{throw Error('SETTINGS_WRITE_FAILED');};
  const failed=await f.post('/api/misskey/settings',{settings:{...settings,hashtag:'Failed'},generation:result.generation});
  expect(failed.status).toBe(500);expect(f.feed.settings.hashtag).toBe('Next');f.settingsStore.commit=commit;
  expect((await f.post('/api/misskey/control',{action:'pause',paused:true})).status).toBe(200);expect(f.feed.snapshot().paused).toBe(true);
  expect((await f.post('/api/misskey/control',{action:'pause',paused:false})).status).toBe(200);
  expect((await f.post('/api/misskey/control',{action:'clear'})).status).toBe(200);
 }finally{await f.app.stop();}
});
test('Misskey configuration survives restart and an unrelated studio setting transaction',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-misskey-'));
 const store=new SettingsStore(directory);await store.initialize();const f=fixture(store);
 try{
  const initial=store.snapshot();const settings={...initial.misskey,maxCards:17,blockedUsers:['abc123'],blockedWords:['custom phrase']};
  expect((await f.post('/api/misskey/settings',{settings,generation:initial.generation})).status).toBe(200);
  const state=f.engine.snapshot();
  const result=await f.post('/api/commands',{type:'studio-set',scene:state.studio,requestId:crypto.randomUUID(),expectedRevision:state.revision});expect(result.status).toBe(200);
  expect((await new SettingsStore(directory).initialize()).misskey).toEqual(settings);
 }finally{await f.app.stop();await rm(directory,{recursive:true,force:true});}
});
