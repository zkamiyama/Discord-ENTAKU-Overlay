import {expect,test} from 'bun:test';
import type {AppSnapshot} from '../../src/contracts/domain.ts';
import {StateReceiver} from '../../src/contracts/state-stream.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {collectEnvironmentPackage,exportEnvironmentPackage} from '../../src/environment/package.ts';
import type {EnvironmentInspection} from '../../src/environment/types.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {startServer} from '../../src/server/app.ts';
import {SettingsStore} from '../../src/storage/settings-store.ts';
import {defaultSettings} from '../../src/storage/settings-schema.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {png} from '../helpers/png.ts';

const BunWebSocket=WebSocket as unknown as {new(url:string,options:{headers:Record<string,string>}):WebSocket};
const turn=async(predicate:()=>boolean)=>{
 const end=performance.now()+3000;
 while(!predicate()&&performance.now()<end)await Bun.sleep(5);
 expect(predicate()).toBe(true);
};
function fixture(){
 const engine=new AppEngine({source:'demo',serverEpoch:'environment-api'});
 for(const event of demoEvents())engine.apply(event);
 const settings=new SettingsStore(null,defaultSettings()),avatars=new AvatarStore(),studios=new StudioStore();
 const app=startServer({engine,settingsStore:settings,avatarStore:avatars,studioStore:studios,misskeyStream:null,assets:{},port:0,now:()=>3500});
 const origin=`http://127.0.0.1:${app.server.port}`;
 const post=(path:string,body:unknown)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const upload=(path:string,bytes:Uint8Array,fields:Record<string,string>={})=>{
  const form=new FormData();form.set('archive',new File([bytes as Uint8Array<ArrayBuffer>],'setup.entaku.zip'));
  for(const [key,value] of Object.entries(fields))form.set(key,value);
  return fetch(origin+path,{method:'POST',headers:{Origin:origin},body:form});
 };
 const inspect=async(bytes:Uint8Array)=>{
  const response=await upload('/api/environment/inspect',bytes);expect(response.status).toBe(200);
  return await response.json() as EnvironmentInspection;
 };
 const apply=(bytes:Uint8Array,review:EnvironmentInspection)=>upload('/api/environment/import',bytes,{
  sha256:review.summary.sha256,expectedRevision:String(review.revision),expectedGeneration:String(review.generation),
 });
 return {engine,settings,avatars,studios,app,origin,post,upload,inspect,apply};
}
async function savedPackage(){
 const engine=new AppEngine({source:'demo',serverEpoch:'saved'});for(const event of demoEvents())engine.apply(event);
 const avatars=new AvatarStore(),studios=new StudioStore(),icon=await avatars.importImage(png(32,32));
 const preset=capturePreset(engine.snapshot(),'dark');preset.studio.tableAnchor.position=[.5,0,-.5];
 const bytes=await exportEnvironmentPackage(await collectEnvironmentPackage({appVersion:'0.1.0-test',createdAt:'2026-01-01T00:00:00Z',preset,
  misskey:{...defaultSettings().misskey!,hashtag:'Portable'},people:{identities:[
   {userId:'100',username:'saved-100',displayName:'保存した名前',iconAssetId:icon.assetId},
   {userId:'101',username:'saved-101',displayName:'保存した二人目'},
  ],presentUserIds:['100','101']}},{avatars,studios}));
 return {bytes,icon:icon.assetId};
}
function connection(origin:string,preview=false){
 const receiver=new StateReceiver(),messages:Record<string,unknown>[]=[];
 let state:AppSnapshot|null=null,rejected=0;
 const socket=new BunWebSocket(origin.replace('http:','ws:')+'/ws'+(preview?'?environment=preview':''),{headers:{Origin:origin}});
 socket.onmessage=event=>{
  const message=JSON.parse(String(event.data));messages.push(message);
  if(message.type==='snapshot'||message.type==='snapshot-delta'){
   const next=receiver.accept(message);if(next)state=next;else rejected++;
  }
 };
 return {socket,messages,get state(){return state;},get rejected(){return rejected;}};
}

test('environment endpoints require same origin, inspect before applying, and publish the complete current setup',async()=>{
 const f=fixture();
 try{
  expect(await (await fetch(f.origin+'/api/environment')).json()).toMatchObject({generation:0,previewAvailable:false});
  expect((await fetch(f.origin+'/ws?environment=preview',{headers:{Origin:f.origin}})).status).toBe(409);
  expect((await fetch(f.origin+'/api/environment/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await fetch(f.origin+'/api/environment/inspect',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:'{}'})).status).toBe(415);
  const exported=await f.post('/api/environment/export',{expectedRevision:0,expectedGeneration:0,theme:'dark'});
  expect(exported.status).toBe(200);expect(exported.headers.get('content-disposition')).toContain('entaku-environment.entaku.zip');
  const bytes=new Uint8Array(await exported.arrayBuffer()),before=f.engine.snapshot();
  const review=await f.inspect(bytes);expect(review.summary.counts.people).toBe(6);
  expect(f.settings.generation).toBe(0);expect(f.engine.snapshot()).toEqual(before);
  const applied=await f.apply(bytes,review);expect(applied.status).toBe(200);
  expect(await applied.json()).toMatchObject({theme:'dark',generation:1,previewAvailable:true});
  expect(f.engine.snapshot().participants).toEqual(before.participants);
  expect(f.settings.snapshot().environment!.presentUserIds).toHaveLength(6);
  const duplicate=new FormData();duplicate.append('archive',new File([bytes],'one.zip'));duplicate.append('archive',new File([bytes],'two.zip'));
  expect((await fetch(f.origin+'/api/environment/inspect',{method:'POST',headers:{Origin:f.origin},body:duplicate})).status).toBe(422);
  const broken=await f.upload('/api/environment/inspect',new TextEncoder().encode('broken ZIP'));
  expect(broken.status).toBe(422);expect(f.settings.generation).toBe(1);
 }finally{await f.app.stop();}
});

test('live Discord image updates and removal never use the saved preview portrait',async()=>{
 const f=fixture(),saved=await savedPackage();
 const first='https://cdn.discordapp.com/avatars/100/old.png',latest='https://cdn.discordapp.com/avatars/100/latest.png';
 const person=f.engine.participant('100')!;
 f.engine.apply({type:'participant-upsert',participant:{...person,avatarUrl:first},sourceGeneration:1,receivedAtMs:3100});
 let live:ReturnType<typeof connection>|undefined,preview:ReturnType<typeof connection>|undefined;
 try{
  expect((await f.apply(saved.bytes,await f.inspect(saved.bytes))).status).toBe(200);
  expect((await (await fetch(f.origin+'/api/misskey/settings')).json()).settings.hashtag).toBe('Portable');
  live=connection(f.origin);preview=connection(f.origin,true);
  await turn(()=>!!live?.state&&!!preview?.state);
  expect(live.state!.participants.find(p=>p.userId==='100')).toMatchObject({displayName:person.displayName,avatarUrl:first});
  expect(live.state!.participants.some(p=>p.iconAssetId)).toBe(false);
  expect(preview.state!.participants).toHaveLength(2);
  expect(preview.state!.participants[0]).toMatchObject({displayName:'保存した名前',iconAssetId:saved.icon,speaking:'unknown'});
  expect(preview.state!.participants.some(p=>p.avatarUrl)).toBe(false);
  expect((await fetch(f.origin+'/api/assets/'+saved.icon)).status).toBe(200);
  f.engine.apply({type:'participant-upsert',participant:{...person,avatarUrl:latest},sourceGeneration:1,receivedAtMs:3200});f.app.broadcast();
  await turn(()=>live?.state?.participants.find(p=>p.userId==='100')?.avatarUrl===latest);
  f.engine.apply({type:'participant-upsert',participant:person,sourceGeneration:1,receivedAtMs:3300});f.app.broadcast();
  await turn(()=>live?.state?.participants.find(p=>p.userId==='100')?.avatarUrl===undefined);
  expect(live.state!.participants.find(p=>p.userId==='100')!.iconAssetId).toBeUndefined();
  expect((await fetch(f.origin+'/api/avatars/100')).status).toBe(404);
  expect(preview.state!.participants[0]!.iconAssetId).toBe(saved.icon);
  const previousEpoch=preview.state!.serverEpoch,settings=f.settings.snapshot();
  const changed=await f.post('/api/misskey/settings',{generation:settings.generation,settings:{...settings.misskey,hashtag:'AfterImport'}});
  expect(changed.status).toBe(200);f.app.broadcast();
  await turn(()=>preview!.state!.serverEpoch!==previousEpoch);
  preview.socket.send(JSON.stringify({type:'resync'}));await turn(()=>preview!.messages.filter(m=>m.type==='snapshot').length>=3);
  expect(live.rejected).toBe(0);expect(preview.rejected).toBe(0);
  preview.socket.send(JSON.stringify({type:'misskey-subscribe'}));
  await turn(()=>preview!.socket.readyState===WebSocket.CLOSED);
  expect(preview.messages.some(m=>m.type==='misskey')).toBe(false);
  expect(live.socket.readyState).toBe(WebSocket.OPEN);
 }finally{live?.socket.close();preview?.socket.close();await f.app.stop();}
});

test('a stale reviewed revision fails without changing settings and failed publication never reconfigures live feeds',async()=>{
 const f=fixture(),{bytes}=await savedPackage();
 try{
  const review=await f.inspect(bytes);f.engine.control({type:'mode',mode:'HOLD'},f.engine.currentRevision,3500);
  expect((await f.apply(bytes,review)).status).toBe(409);
  const current=await f.inspect(bytes),before=f.engine.snapshot();
  f.settings.commit=()=>{throw new Error('SETTINGS_WRITE_FAILED');};
  const failed=await f.apply(bytes,current);expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({error:'SETTINGS_WRITE_FAILED'});
  expect(f.engine.snapshot()).toEqual(before);expect(f.settings.generation).toBe(0);
  expect(await (await fetch(f.origin+'/api/environment')).json()).toMatchObject({previewAvailable:false});
  expect((await (await fetch(f.origin+'/api/misskey')).json()).hashtag).toBe(defaultSettings().misskey!.hashtag);
 }finally{await f.app.stop();}
});

test('only one environment operation is admitted while ordinary reads remain responsive',async()=>{
 const f=fixture(),image=await f.avatars.importImage(png());
 const profile=await f.avatars.validateDraft({userId:'100',assetId:image.assetId,faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0});
 f.engine.setAvatarProfiles([profile],f.engine.currentRevision,3500);
 let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const original=f.avatars.get.bind(f.avatars);f.avatars.get=async id=>{entered();await gate;return original(id);};
 const request={theme:'system',expectedRevision:f.engine.currentRevision,expectedGeneration:0};
 const exporting=f.post('/api/environment/export',request);
 try{
  await started;
  const second=await f.post('/api/environment/export',request);
  expect(second.status).toBe(503);expect(await second.json()).toEqual({error:'ENVIRONMENT_BUSY'});
  expect((await fetch(f.origin+'/api/health')).status).toBe(200);
  release();expect((await exporting).status).toBe(200);
  expect((await f.post('/api/environment/export',request)).status).toBe(200);
 }finally{release();await exporting;await f.app.stop();}
});
