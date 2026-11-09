import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {startServer} from '../../src/server/app.ts';
import {PresetStore} from '../../src/presets/store.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {capturePreset} from '../../src/presets/schema.ts';
test('preset API is revision-safe, lists JSON and rejects partial application on a save error',async()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'preset'});for(const v of demoEvents())engine.apply(v);
 const presets=new PresetStore(),assets=new AvatarStore(),studios=new StudioStore();const app=startServer({engine,presets,avatarStore:assets,studioStore:studios,assets:{},port:0,now:()=>5000});const origin=`http://127.0.0.1:${app.server.port}`;
 const command=(input:any,revision=engine.snapshot().revision)=>fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:revision,...input})});
 try{
  expect((await command({type:'preset-save',name:'放送',theme:'dark'})).status).toBe(200);
  expect((await (await fetch(origin+'/api/presets')).json()).items).toEqual([{name:'放送.json',valid:true}]);
  expect((await command({type:'preset-save',name:'放送',theme:'light'})).status).toBe(422);
  const p=await presets.read('放送.json');await presets.create('変更',{...p,studio:{...p.studio,exposure:{...p.studio.exposure!,compensationEV:-2}}});
  const before=engine.snapshot(),save=assets.saveProfiles.bind(assets);assets.saveProfiles=async()=>{throw new Error('AVATAR_SETTINGS_WRITE_FAILED');};
  expect((await command({type:'preset-apply',name:'変更.json'})).status).toBe(422);expect(engine.snapshot().studio).toEqual(before.studio);expect(engine.snapshot().revision).toBe(before.revision);expect(studios.snapshot().exposure).toEqual(before.studio.exposure);
  assets.saveProfiles=save;expect((await command({type:'preset-apply',name:'変更.json'})).status).toBe(200);expect(engine.snapshot().studio.exposure?.compensationEV).toBe(-2);
  expect((await command({type:'preset-apply',name:'放送.json'},before.revision)).status).toBe(409);
 }finally{await app.stop();}
});
test('preset missing studio asset is rejected before changing the current parameters',async()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'missing'});for(const v of demoEvents())engine.apply(v);const presets=new PresetStore();
 const p=capturePreset(engine.snapshot(),'system');p.studio.objects=[{id:'missing',kind:'model',bundleId:'f'.repeat(64),transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}}];await presets.create('不足',p);
 const app=startServer({engine,presets,assets:{},port:0,now:()=>5000}),origin=`http://127.0.0.1:${app.server.port}`,before=engine.snapshot();
 try{const r=await fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({type:'preset-apply',name:'不足.json',expectedRevision:before.revision,requestId:'missing'})});expect(r.status).toBe(422);expect(engine.snapshot().studio).toEqual(before.studio);expect(engine.snapshot().revision).toBe(before.revision);}finally{await app.stop();}
});

test('channel switch during the last preset write rolls back preferences and stored settings',async()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'context'});for(const v of demoEvents())engine.apply(v);
 const presets=new PresetStore(),assets=new AvatarStore(),studios=new StudioStore();
 const original=capturePreset(engine.snapshot(),'system');await presets.preferences(original);
 await presets.create('new',{...original,autoCamera:false,studio:{...original.studio,exposure:{...original.studio.exposure!,compensationEV:2}}});
 const preferences=presets.preferences.bind(presets);let changed=false;
 presets.preferences=async value=>{
  const result=await preferences(value);
  if(value&&value.autoCamera===false&&!changed){changed=true;engine.apply({type:'snapshot',channel:{channelId:'999',name:'別の通話',kind:'guild-voice'},participants:[],sourceGeneration:2,receivedAtMs:5100});}
  return result;
 };
 const app=startServer({engine,presets,avatarStore:assets,studioStore:studios,assets:{},port:0,now:()=>5200});const origin=`http://127.0.0.1:${app.server.port}`;
 try{
  const r=await fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({type:'preset-apply',name:'new.json',expectedRevision:engine.snapshot().revision,requestId:'context'})});
  expect(r.status).toBe(422);expect(await r.json()).toMatchObject({error:'PRESET_CONTEXT_CHANGED'});
  expect(engine.snapshot().studio.exposure).toEqual(undefined);expect(engine.snapshot().channel?.channelId).toBe('999');
  expect(await presets.preferences()).toEqual(original);expect(studios.snapshot().exposure).toBeUndefined();
 }finally{await app.stop();}
});
