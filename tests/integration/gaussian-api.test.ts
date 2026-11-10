import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {startServer} from '../../src/server/app.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {PresetStore} from '../../src/presets/store.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {gaussianFixture,gaussianSpz} from '../helpers/gaussian.ts';
import {capturePreset} from '../../src/presets/schema.ts';
function start(){const assets=new AvatarStore(),presets=new PresetStore(),studios=new StudioStore(),engine=new AppEngine({source:'demo',serverEpoch:'gaussian-api'});for(const e of demoEvents())engine.apply(e);const app=startServer({engine,avatarStore:assets,studioStore:studios,presets,assets:{},port:0,now:()=>100});const origin=`http://127.0.0.1:${app.server.port}`;
 const command=(input:Record<string,unknown>)=>fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:engine.snapshot().revision,...input})});
 const upload=(archive:Uint8Array,headers:Record<string,string>={Origin:origin})=>{const form=new FormData();form.set('archive',new File([archive as Uint8Array<ArrayBuffer>],'avatar.zip'));return fetch(origin+'/api/gaussian-assets/import',{method:'POST',headers,body:form});};return {assets,presets,studios,engine,app,origin,command,upload};}
test('local Gaussian API imports, assigns, exports calibration and keeps proxy files same-origin',async()=>{
 const f=start(),fixture=gaussianFixture(3);
 try{
  expect((await f.upload(fixture.archive,{})).status).toBe(403);expect((await f.upload(fixture.archive,{Origin:'http://attacker.invalid'})).status).toBe(403);
  const imported=await f.upload(fixture.archive);expect(imported.status).toBe(201);const asset=await imported.json();expect(f.engine.snapshot().avatarProfiles).toEqual([]);
  expect((await (await fetch(f.origin+'/api/gaussian-assets')).json()).map((a:{assetId:string})=>a.assetId)).toEqual([asset.assetId]);
  const metadata=await (await fetch(f.origin+'/api/gaussian-assets/'+asset.assetId)).json();expect(metadata.splatCount).toBe(fixture.splatCount);
  const proxy=await fetch(f.origin+`/api/gaussian-assets/${asset.assetId}/file?path=proxy.glb`);expect(proxy.headers.get('content-type')).toBe('model/gltf-binary');expect(proxy.headers.get('content-security-policy')).not.toContain("'unsafe-eval'");expect(proxy.headers.get('content-security-policy')).toContain("'wasm-unsafe-eval'");
  expect([...new Uint8Array(await proxy.arrayBuffer())]).toEqual([...fixture.files[2]!.bytes]);
  expect((await fetch(f.origin+`/api/gaussian-assets/${asset.assetId}/file?path=../avatars.json`)).status).toBe(404);
  const userId=f.engine.snapshot().participants[0]!.userId,profile={kind:'gaussian' as const,userId,assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:.1,offsetY:.2,offsetZ:.1,yawRad:.3};
  expect((await f.command({type:'avatar-set',profile})).status).toBe(200);expect(f.engine.snapshot().avatarProfiles).toEqual([profile]);
  const manifest={...asset.manifest,placement:{scale:1,offsetX:.1,offsetY:.2,offsetZ:.1,yawRad:.3}};
  const zip=await fetch(f.origin+`/api/gaussian-assets/${asset.assetId}/export`,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({manifest})});expect(zip.status).toBe(200);expect(zip.headers.get('content-type')).toBe('application/zip');
  const copy=await f.upload(new Uint8Array(await zip.arrayBuffer()));expect((await copy.json()).manifest).toEqual(manifest);
 }finally{await f.app.stop();}
});
test('Gaussian presets restore assignments and reject missing assets before changing runtime or saved settings',async()=>{
 const f=start();try{
  const asset=await f.assets.gaussian.importZip(gaussianFixture(2).archive),profile={kind:'gaussian' as const,userId:f.engine.snapshot().participants[0]!.userId,assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0};
  expect((await f.command({type:'avatar-set',profile})).status).toBe(200);expect((await f.command({type:'preset-save',name:'Gaussian',theme:'dark'})).status).toBe(200);
  expect((await f.command({type:'avatar-reset',userId:profile.userId})).status).toBe(200);expect(f.engine.snapshot().avatarProfiles).toEqual([]);
  expect((await f.command({type:'preset-apply',name:'Gaussian.json'})).status).toBe(200);expect(f.engine.snapshot().avatarProfiles).toEqual([profile]);
  const bad=capturePreset(f.engine.snapshot(),'light');bad.avatarProfiles=[{...bad.avatarProfiles[0]!,assetId:'f'.repeat(64)}];await f.presets.create('missing',bad);
  const before=f.engine.snapshot(),saved=f.assets.snapshot();const response=await f.command({type:'preset-apply',name:'missing.json'});expect(response.status).toBe(422);expect(await response.json()).toMatchObject({error:'GAUSSIAN_ASSET_NOT_FOUND'});expect(f.engine.snapshot().revision).toBe(before.revision);expect(f.engine.snapshot().avatarProfiles).toEqual(before.avatarProfiles);expect(f.assets.snapshot()).toEqual(saved);
 }finally{await f.app.stop();}
});
test('a Gaussian save failure retains the previous 2D/GS assignment, revision and package',async()=>{
 const f=start();try{
  const asset=await f.assets.gaussian.importZip(gaussianFixture().archive),profile={kind:'gaussian' as const,userId:'1',assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0};
  const before=f.engine.snapshot();f.assets.saveProfiles=async()=>{throw new Error('AVATAR_SETTINGS_WRITE_FAILED');};const response=await f.command({type:'avatar-set',profile});expect(response.status).toBe(422);expect(await response.json()).toMatchObject({error:'AVATAR_SETTINGS_WRITE_FAILED'});expect(f.engine.snapshot().revision).toBe(before.revision);expect(f.engine.snapshot().avatarProfiles).toEqual(before.avatarProfiles);expect((await f.assets.gaussian.list()).length).toBe(1);
  const form=new FormData();form.set('splat',new File([Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0')],'pointcloud.ply'));
  const bad=await fetch(f.origin+'/api/gaussian-assets/import',{method:'POST',headers:{Origin:f.origin},body:form});expect(await bad.json()).toEqual({error:'GAUSSIAN_PLY_NOT_3DGS'});expect(f.engine.snapshot().avatarProfiles).toEqual(before.avatarProfiles);
 }finally{await f.app.stop();}
});
test('avatar-set and preset apply reject source-budget overflow before changing runtime or any saved settings',async()=>{
 const f=start();try{
  const asset=await f.assets.gaussian.importRaw({path:'million.spz',bytes:gaussianSpz(1,1_000_000)});
  const profile={kind:'gaussian' as const,userId:'900',assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0};
  // These users are not connected: the budget follows saved assignments.
  for(let i=0;i<8;i++)expect((await f.command({type:'avatar-set',profile:{...profile,userId:String(900+i)}})).status).toBe(200);
  const before=f.engine.snapshot(),saved=f.assets.snapshot(),scene=f.studios.snapshot(),preferences=await f.presets.preferences();
  const overflow=await f.command({type:'avatar-set',profile:{...profile,userId:'908'}});
  expect(overflow.status).toBe(422);expect(await overflow.json()).toEqual({error:'GAUSSIAN_ACTIVE_SPLAT_LIMIT'});
  const preset=capturePreset(before,'dark');preset.avatarProfiles.push({...profile,userId:'908'});await f.presets.create('overflow',preset);
  let sceneWrites=0;const save=f.studios.save.bind(f.studios);f.studios.save=async input=>{sceneWrites++;return save(input);};
  const restore=await f.command({type:'preset-apply',name:'overflow.json'});
  expect(restore.status).toBe(422);expect(await restore.json()).toEqual({error:'GAUSSIAN_ACTIVE_SPLAT_LIMIT'});expect(sceneWrites).toBe(0);
  expect(f.engine.snapshot().revision).toBe(before.revision);expect(f.engine.snapshot().avatarProfiles).toEqual(before.avatarProfiles);
  expect(f.assets.snapshot()).toEqual(saved);expect(f.studios.snapshot()).toEqual(scene);expect(await f.presets.preferences()).toEqual(preferences);
 }finally{await f.app.stop();}
});
