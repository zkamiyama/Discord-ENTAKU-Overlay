import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {startServer} from '../../src/server/app.ts';
import {VcChatFeed} from '../../src/chat/vc-chat-feed.ts';
import {NoteIntroductionFeed} from '../../src/note-introduction/feed.ts';
import {SettingsStore} from '../../src/storage/settings-store.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {inspectEnvironmentPackage} from '../../src/environment/package.ts';
import type {NoteIntroductionSettings} from '../../src/contracts/note-introduction.ts';

const until=async(predicate:()=>boolean)=>{const end=performance.now()+4000;while(!predicate()){if(performance.now()>end)throw new Error('INTRODUCTION_TEST_TIMEOUT');await Bun.sleep(5);}};
const BunWS=WebSocket as unknown as {new(url:string,options:{headers:Record<string,string>}):WebSocket};
async function fixture(store=new SettingsStore()){
  const engine=new AppEngine({source:'demo',serverEpoch:'introduction-test'});for(const event of demoEvents())engine.apply(event);
  const vcChat=new VcChatFeed('unavailable'),listeners=new Set<(packet:Record<string,unknown>)=>void>(),requests:string[]=[];
  const rpc={onEvent:(cb:(packet:Record<string,unknown>)=>void)=>{listeners.add(cb);return()=>{listeners.delete(cb);};},request:async(_cmd:string,_args:unknown,evt?:string)=>({evt})};
  const intro=new NoteIntroductionFeed(store.snapshot().noteIntroduction,{fetch:(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    const {noteId}=JSON.parse(String(init?.body));requests.push(noteId);
    return Response.json({id:noteId,createdAt:'2026-11-28T00:00:00.000Z',user:{id:'guest',username:'guest',name:'Synthetic author'},
      text:'INTRODUCTION_BODY '+noteId,visibility:'public',cw:null,files:[]});
  }) as typeof fetch});
  const app=startServer({engine,assets:{},vcChat,noteIntroduction:intro,misskeyStream:null,settingsStore:store,port:0,now:()=>1000});
  const origin=`http://127.0.0.1:${app.server.port}`;
  await vcChat.start(rpc,{id:'200',name:'Synthetic VC',type:2});
  const dispatch=(evt:string,message:Record<string,unknown>)=>{for(const listener of listeners)listener({cmd:'DISPATCH',evt,data:{channel_id:'200',message}});};
  const post=(path:string,data:unknown,from=origin)=>fetch(origin+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const share=(id:string,noteId:string)=>dispatch('MESSAGE_CREATE',{id,author:{id:'42',username:'Presenter'},content:`https://otomad.site/notes/${noteId}`,timestamp:new Date().toISOString()});
  return {app,engine,vcChat,intro,store,requests,origin,post,dispatch,share};
}

test('VC note introduction is independently subscribed, dismissible with a lease, and absent from voice state and recordings',async()=>{
  const f=await fixture(),packets:any[]=[],other:any[]=[];
  const ws=new BunWS(f.origin.replace('http:','ws:')+'/ws',{headers:{Origin:f.origin}}),idle=new BunWS(f.origin.replace('http:','ws:')+'/ws',{headers:{Origin:f.origin}});
  ws.onmessage=e=>packets.push(JSON.parse(String(e.data)));idle.onmessage=e=>other.push(JSON.parse(String(e.data)));
  try{
    await until(()=>packets.some(m=>m.type==='hello')&&other.some(m=>m.type==='hello'));
    ws.send(JSON.stringify({type:'note-introduction-subscribe'}));
    await until(()=>packets.some(m=>m.type==='note-introduction'));
    const oldRevision=f.intro.snapshot().revision;
    f.share('1','first');await until(()=>f.intro.snapshot().card!==null);
    await until(()=>packets.some(m=>m.type==='note-introduction'&&m.state.card?.id==='first'));
    const state=await (await fetch(f.origin+'/api/note-introduction')).json();
    expect(state.card.text).toBe('INTRODUCTION_BODY first');
    expect(JSON.stringify(packets.filter(m=>m.type.startsWith('snapshot')))).not.toContain('INTRODUCTION_BODY');
    expect(JSON.stringify(other)).not.toContain('INTRODUCTION_BODY');
    expect(await (await fetch(f.origin+'/api/diagnostics')).text()).not.toContain('INTRODUCTION_BODY');
    expect(JSON.stringify(capturePreset(f.engine.snapshot(),'dark'))).not.toContain('INTRODUCTION_BODY');
    expect((await f.post('/api/note-introduction/control',{action:'dismiss',revision:state.revision},'https://evil.example')).status).toBe(403);
    expect((await f.post('/api/note-introduction/control',{action:'dismiss',revision:oldRevision})).status).toBe(409);
    expect(f.intro.snapshot().card?.id).toBe('first');
    expect((await f.post('/api/note-introduction/control',{action:'dismiss',revision:state.revision})).status).toBe(200);
    f.dispatch('MESSAGE_CREATE',{id:'2',author:{id:'42',username:'Presenter'},content:'普通のチャット',timestamp:new Date().toISOString()});
    expect(f.intro.snapshot().card).toBeNull();expect(f.requests).toEqual(['first']);
  }finally{ws.close();idle.close();await f.app.stop();}
});

test('configuration validates JSON, commits before feed changes, and retains the on-air card after a failed save',async()=>{
  const f=await fixture();
  try{
    f.share('1','existing');await until(()=>f.intro.snapshot().card!==null);
    const before=await (await fetch(f.origin+'/api/note-introduction/settings')).json();
    const settings={...before.settings,instances:['https://stage.example.org']};
    expect((await f.post('/api/note-introduction/settings',{...before,settings:{...settings,instances:['https://127.0.0.1']}})).status).toBe(422);
    const commit=f.store.commit.bind(f.store);f.store.commit=()=>{throw Error('SETTINGS_WRITE_FAILED');};
    expect((await f.post('/api/note-introduction/settings',{...before,settings})).status).toBe(500);
    expect(f.intro.snapshot().card?.id).toBe('existing');expect(f.store.snapshot().noteIntroduction).toEqual(before.settings);
    f.store.commit=commit;
    expect((await f.post('/api/note-introduction/settings',{...before,settings})).status).toBe(200);
    expect(f.intro.snapshot().card).toBeNull();
    expect((await f.post('/api/note-introduction/settings',{...before,settings})).status).toBe(409);
    f.share('2','ignored');await Bun.sleep(20);expect(f.requests).toEqual(['existing']);
  }finally{await f.app.stop();}
});

test('introduction settings survive restart and round-trip with the environment package while the current note is excluded',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'entaku-introduction-')),store=new SettingsStore(directory);await store.initialize();
  const f=await fixture(store);
  try{
    const settings:NoteIntroductionSettings={schemaVersion:1,enabled:true,instances:['https://otomad.site','https://stage.example.org'],includeHome:true};
    expect((await f.post('/api/note-introduction/settings',{generation:store.generation,settings})).status).toBe(200);
    f.share('1','package-test');await until(()=>f.intro.snapshot().card!==null);
    expect((await new SettingsStore(directory).initialize()).noteIntroduction).toEqual(settings);
    const response=await f.post('/api/environment/export',{expectedGeneration:store.generation,expectedRevision:f.engine.currentRevision,theme:'dark'});
    expect(response.status).toBe(200);const bytes=new Uint8Array(await response.arrayBuffer());
    const inspected=await inspectEnvironmentPackage(bytes);expect(inspected.content.manifest.noteIntroduction).toEqual(settings);
    expect(JSON.stringify(inspected.content.manifest)).not.toContain('INTRODUCTION_BODY');
    expect((await f.post('/api/note-introduction/settings',{generation:store.generation,settings:{...settings,enabled:false}})).status).toBe(200);
    const form=new FormData();form.set('archive',new File([bytes],'environment.entaku.zip'));
    const inspection=await (await fetch(f.origin+'/api/environment/inspect',{method:'POST',headers:{Origin:f.origin},body:form})).json();
    form.set('expectedRevision',String(inspection.revision));form.set('expectedGeneration',String(inspection.generation));form.set('sha256',inspection.summary.sha256);
    expect((await fetch(f.origin+'/api/environment/import',{method:'POST',headers:{Origin:f.origin},body:form})).status).toBe(200);
    expect(store.snapshot().noteIntroduction).toEqual(settings);expect(f.intro.snapshot().status).toBe('idle');
    expect((await new SettingsStore(directory).initialize()).noteIntroduction).toEqual(settings);
  }finally{await f.app.stop();await rm(directory,{recursive:true,force:true});}
});
