import {expect,test} from 'bun:test';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zipSync} from 'fflate';
import {GaussianStore,unpackGaussianZip} from '../../src/assets/gaussian-store.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {validateProfile} from '../../src/assets/avatar-profile.ts';
import {gaussianFixture,gaussianSpz} from '../helpers/gaussian.ts';
import {png} from '../helpers/png.ts';
import {GAUSSIAN_LIMITS} from '../../src/assets/gaussian-profile.ts';
const fixture=gaussianFixture();
test('character ZIP roundtrips with modified calibration into an empty directory and different participant',async()=>{
 const firstDir=await mkdtemp(join(tmpdir(),'entaku-gs-a-')),secondDir=await mkdtemp(join(tmpdir(),'entaku-gs-b-'));
 try{
  const first=new AvatarStore(firstDir);await first.initialize();const asset=await first.gaussian.importZip(fixture.archive);expect((await first.gaussian.importZip(fixture.archive)).assetId).toBe(asset.assetId);
  const manifest={...asset.manifest,normalization:{...asset.manifest.normalization,rotation:[0,.3,0] as const},placement:{scale:.8,offsetX:.1,offsetY:-.1,offsetZ:.2,yawRad:.4}};
  const profile=await first.validateDraft({kind:'gaussian',userId:'123',assetId:asset.assetId,manifest,...manifest.placement});await first.saveProfiles([profile]);
  expect(await new AvatarStore(firstDir).initialize()).toEqual([profile]);expect(JSON.parse(await readFile(join(firstDir,'avatars.json'),'utf8')).schemaVersion).toBe(2);
  const archive=await first.gaussian.exportZip(asset.assetId,manifest),second=new AvatarStore(secondDir);await second.initialize();const imported=await second.gaussian.importZip(archive);
  expect(imported.manifest).toEqual(manifest);expect(imported.manifest).not.toHaveProperty('userId');
  const other=await second.validateDraft({kind:'gaussian',userId:'456',assetId:imported.assetId,manifest:imported.manifest,...imported.manifest.placement});await second.saveProfiles([other]);
  expect((await new AvatarStore(secondDir).initialize())[0]).toMatchObject({userId:'456',manifest,scale:.8,offsetZ:.2,yawRad:.4});
  expect((await second.gaussian.file(imported.assetId,'proxy.glb')).bytes).toEqual((await first.gaussian.file(asset.assetId,'proxy.glb')).bytes);
 }finally{await rm(firstDir,{recursive:true,force:true});await rm(secondDir,{recursive:true,force:true});}
});
test('legacy avatars.json schema1 and image presets retain back images, face and crop',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-legacy-'));
 try{const store=new AvatarStore(dir);await store.initialize();const image=await store.importImage(png()),legacy={userId:'1',assetId:image.assetId,image:{width:image.width,height:image.height,mime:image.mime},faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0,back:{assetId:image.assetId,image:{width:image.width,height:image.height,mime:image.mime},faceRect:[.2,.1,.5,.25]},framingRect:[0,0,1,1]};
  await writeFile(join(dir,'avatars.json'),JSON.stringify({schemaVersion:1,profiles:[legacy]}));const restored=await new AvatarStore(dir).initialize();expect(restored).toEqual([validateProfile(legacy)]);expect(restored[0]).not.toHaveProperty('kind');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('eight fixtures represent different source geometry, counts and assets; optional proxy and raw SPZ import work',async()=>{
 const store=new GaussianStore(),ids=new Set<string>(),counts=new Set<number>();for(let index=0;index<8;index++){const f=gaussianFixture(index),asset=await store.importZip(f.archive);ids.add(asset.assetId);counts.add(asset.splatCount);}
 expect(ids.size).toBe(8);expect(counts.size).toBe(8);expect(await store.list()).toHaveLength(8);
 const noProxy=await store.importZip(gaussianFixture(0,{proxy:false}).archive);expect(noProxy.manifest.proxy).toBeUndefined();
 const raw=await store.importRaw({path:'avatar.spz',bytes:gaussianSpz(4)});expect(raw.splatCount).toBe(3);expect(raw.manifest.normalization.scale).toBeGreaterThan(1);
});
test('invalid manifests, missing references and failed saves never publish partial packages or profiles',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-gs-fail-'));
 try{
  const store=new AvatarStore(dir);await store.initialize();const asset=await store.gaussian.importZip(fixture.archive);const profile=await store.validateDraft({kind:'gaussian',userId:'1',assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0});await store.saveProfiles([profile]);
  const old=store.snapshot(),files=fixture.files.filter(f=>f.path!=='proxy.glb');await expect(store.gaussian.importFiles(files)).rejects.toThrow('GAUSSIAN_REFERENCE_MISSING');
  await expect(store.gaussian.importFiles(fixture.files.map(f=>f.path==='manifest.json'?{...f,bytes:Buffer.from('{broken')}:f))).rejects.toThrow('GAUSSIAN_MANIFEST_INVALID');
  await expect(store.validateDraft({...profile,manifest:{...asset.manifest,proxy:undefined}})).rejects.toThrow('GAUSSIAN_REFERENCE_INVALID');
  expect(store.snapshot()).toEqual(old);expect(await store.gaussian.list()).toHaveLength(1);expect((await readdir(join(dir,'assets','gaussians'))).some(f=>f.startsWith('.pending'))).toBe(false);
  await mkdir(join(dir,'avatars.json.bak'));await expect(store.saveProfiles([])).rejects.toThrow('AVATAR_SETTINGS_WRITE_FAILED');expect(store.snapshot()).toEqual(old);
  expect(JSON.parse(await readFile(join(dir,'avatars.json'),'utf8')).profiles).toEqual(old);
  const model=asset.files.find(f=>f.path==='avatar.ply')!;await writeFile(join(dir,'assets','gaussians',asset.assetId,model.hash),'broken');await expect(store.validateDraft(profile)).rejects.toThrow('GAUSSIAN_FILE_CORRUPT');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('archive paths/count/decompression bounds and store quota reject abuse without losing existing assets',async()=>{
 const store=new GaussianStore();const asset=await store.importZip(fixture.archive);
 expect(()=>unpackGaussianZip(fixture.archive.subarray(0,fixture.archive.length-1))).toThrow('GAUSSIAN_ARCHIVE_INVALID');
 expect(()=>unpackGaussianZip(zipSync({'../avatar.ply':new Uint8Array([1])}))).toThrow('GAUSSIAN_PATH_REJECTED');
 expect(()=>unpackGaussianZip(zipSync(Object.fromEntries(Array.from({length:65},(_,i)=>[`${i}.ply`,new Uint8Array([1])]))))).toThrow('GAUSSIAN_FILE_LIMIT');
 const huge=zipSync({'manifest.json':Buffer.alloc(65537,32)});expect(()=>unpackGaussianZip(huge)).toThrow(/GAUSSIAN_(FILE_TOO_LARGE|ARCHIVE_TOO_LARGE)/);
 const tiny=Buffer.from(zipSync({'a.ply':new Uint8Array([1])}));tiny.writeUInt32LE(GAUSSIAN_LIMITS.fileBytes+1,22);expect(()=>unpackGaussianZip(tiny)).toThrow('GAUSSIAN_FILE_TOO_LARGE');
 await expect(store.importFiles([...fixture.files,fixture.files[1]!])).rejects.toThrow('GAUSSIAN_DUPLICATE_PATH');
 const raw=gaussianSpz(3);for(let i=1;i<128;i++)await store.importRaw({path:'avatar.spz',bytes:raw},[],{...fixture.manifest,name:`asset ${i}`,splat:'avatar.spz',proxy:undefined});
 await expect(store.importRaw({path:'avatar.spz',bytes:raw},[],{...fixture.manifest,name:'overflow',splat:'avatar.spz',proxy:undefined})).rejects.toThrow('GAUSSIAN_STORE_FULL');
 expect(await store.list()).toHaveLength(128);expect((await store.file(asset.assetId,'avatar.ply')).bytes).toEqual(fixture.files[1]!.bytes);
});
test('raw zero-extent source points receive finite editable default bounds, and malformed payloads never become assets',async()=>{
 const store=new GaussianStore();const asset=await store.importRaw({path:'one.spz',bytes:gaussianSpz(1,1)});
 expect(Number.isFinite(asset.manifest.normalization.scale)).toBe(true);
 for(const box of [asset.manifest.bodyBounds,asset.manifest.faceBounds,asset.manifest.framingBounds])expect(box.min.every((v,i)=>v<box.max[i]!)).toBe(true);
 const bytes=gaussianSpz(3,1);await expect(store.importRaw({path:'truncated.spz',bytes:bytes.subarray(0,bytes.length-1)})).rejects.toThrow('GAUSSIAN_SPZ_INVALID');
 expect((await store.list()).map(a=>a.assetId)).toEqual([asset.assetId]);
});
test('saved Gaussian instances share the eight-million source budget and failed overflow leaves disk unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-gs-budget-'));
 try{
  const store=new AvatarStore(dir);await store.initialize();
  const asset=await store.gaussian.importRaw({path:'million.spz',bytes:gaussianSpz(1,GAUSSIAN_LIMITS.splats)});
  const profile=await store.validateDraft({kind:'gaussian',userId:'1',assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0});
  const atLimit=Array.from({length:8},(_,i)=>({...profile,userId:String(900+i)}));
  await store.saveProfiles(atLimit);const before=await readFile(join(dir,'avatars.json'),'utf8');
  await expect(store.saveProfiles([...atLimit,{...profile,userId:'908'}])).rejects.toThrow('GAUSSIAN_ACTIVE_SPLAT_LIMIT');
  expect(store.snapshot()).toEqual(atLimit);expect(await readFile(join(dir,'avatars.json'),'utf8')).toBe(before);
  expect(await new AvatarStore(dir).initialize()).toEqual(atLimit);
  // Replacing an assignment keeps the same instance count; it is not an append.
  await store.saveProfiles(atLimit.map((p,i)=>i===0?{...p,offsetX:.1}:p));expect(store.snapshot()[0]?.offsetX).toBe(.1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
