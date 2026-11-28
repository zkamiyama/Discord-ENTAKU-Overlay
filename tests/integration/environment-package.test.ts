import {expect,test} from 'bun:test';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zipSync} from 'fflate';
import {AvatarStore} from '../../src/assets/store.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {DEFAULT_MISSKEY_SETTINGS} from '../../src/misskey/settings.ts';
import {environmentHash} from '../../src/environment/archive.ts';
import {collectEnvironmentPackage,exportEnvironmentPackage,inspectEnvironmentPackage,publishEnvironmentPackage,type EnvironmentContent,type EnvironmentStores} from '../../src/environment/package.ts';
import type {EnvironmentConfiguration} from '../../src/environment/types.ts';
import {gaussianFixture,gaussianSpz} from '../helpers/gaussian.ts';
import {png} from '../helpers/png.ts';

const json=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
function configuration():EnvironmentConfiguration {
  const engine=new AppEngine({source:'demo',serverEpoch:'package-fixture'});for(const event of demoEvents())engine.apply(event);
  return {appVersion:'0.1.0-test',createdAt:'2026-11-28T00:00:00.000Z',preset:capturePreset(engine.snapshot(),'dark'),
    misskey:{...structuredClone(DEFAULT_MISSKEY_SETTINGS),enabled:true,blockedWords:['例の禁止語'],blockedUsers:['blocked-1']},people:{identities:[],presentUserIds:[]}};
}
async function fixture() {
  const stores:EnvironmentStores={avatars:new AvatarStore(),studios:new StudioStore()},config=configuration();
  const front=png(),back=png(96,128),icon=png(64,64),image=await stores.avatars.importImage(front),backImage=await stores.avatars.importImage(back),iconId=await environmentHash(icon);
  const modelBytes=json({asset:{version:'2.0'},buffers:[{uri:'../shared/mesh.bin',byteLength:12}],images:[{uri:'../shared/front.png'}]});
  const model=await stores.studios.importFiles([{path:'models/stage.gltf',bytes:modelBytes},{path:'shared/mesh.bin',bytes:new Uint8Array(12)},
    {path:'shared/front.png',bytes:front},{path:'source-metadata.json',bytes:json({note:'元のbundle IDを維持する未参照ファイル'})}]);
  const gaussian=await stores.avatars.gaussian.importFiles(gaussianFixture().files);
  config.preset.avatarProfiles=[await stores.avatars.validateDraft({userId:'101',assetId:image.assetId,image,faceRect:[.25,.1,.5,.25],scale:1,offsetX:.1,offsetY:-.1,
    back:{assetId:backImage.assetId,image:backImage,faceRect:[.25,.1,.5,.25]},framingRect:[0,0,1,1]}),
    await stores.avatars.validateDraft({kind:'gaussian',userId:'102',assetId:gaussian.assetId,manifest:{...gaussian.manifest,normalization:{...gaussian.manifest.normalization,rotation:[0,.3,0]}},scale:.8,offsetX:0,offsetY:.1,offsetZ:.2,yawRad:.4}),
    await stores.avatars.validateDraft({kind:'gaussian',userId:'103',assetId:gaussian.assetId,manifest:gaussian.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0})];
  config.preset.studio.objects.push({id:'external-stage',kind:'model',bundleId:model.bundleId,transform:{position:[4,1,-2],yawDeg:23,scale:[1.5,2,.5]},speakerUserId:'101'});
  config.preset.studio.exposure={...config.preset.studio.exposure!,compensationEV:-1.25};config.preset.autoCamera=false;
  config.preset.seating.assignments=[{userId:'101',slotIndex:0},{userId:'102',slotIndex:1},{userId:'103',slotIndex:2}];
  config.people={identities:[{userId:'101',username:'one',displayName:'画像の人物',iconAssetId:image.assetId},{userId:'102',username:'two',displayName:'3Dの人物',iconAssetId:iconId},{userId:'103',username:'three',displayName:'もう一人'}],presentUserIds:['101','102','103']};
  return {stores,config,model,modelBytes,gaussian,image,backImage,iconId,extra:new Map([[iconId,icon]])};
}
function unsafeArchive(content:EnvironmentContent):Uint8Array {
  return zipSync({'entaku.json':json(content.manifest),...Object.fromEntries([...content.blobs].map(([hash,bytes])=>[`assets/${hash}`,bytes]))},{level:0});
}

test('one package recreates settings, logical model paths, both avatar sides, Gaussian calibration and standard icons in an empty environment',async()=>{
  const f=await fixture(),directory=await mkdtemp(join(tmpdir(),'entaku-environment-target-'));
  try{
    const content=await collectEnvironmentPackage(f.config,f.stores,f.extra);
    // PNG shared by a custom avatar, a standard icon and a GLTF texture occurs once.
    expect(content.manifest.images).toHaveLength(3);expect(content.manifest.gaussians).toHaveLength(1);
    expect(content.manifest.blobs.filter(b=>b.sha256===f.image.assetId)).toHaveLength(1);
    expect(content.manifest.studios[0]?.files.some(file=>file.path==='source-metadata.json')).toBe(true);
    const bytes=await exportEnvironmentPackage(content),target:EnvironmentStores={avatars:new AvatarStore(directory),studios:new StudioStore(directory)};
    await target.avatars.initialize();await target.studios.initialize();
    const {content:inspected,summary}=await inspectEnvironmentPackage(bytes);
    expect(await target.studios.list()).toEqual([]);expect(await target.avatars.gaussian.list()).toEqual([]);expect(await readdir(join(directory,'assets','avatars'))).toEqual([]);
    expect(summary).toMatchObject({appVersion:f.config.appVersion,createdAt:f.config.createdAt,theme:'dark',sha256:await environmentHash(bytes),counts:{studioBundles:1,images:3,gaussians:1,people:3}});
    expect(inspected.manifest.preset).toEqual(f.config.preset);expect(inspected.manifest.people).toEqual(f.config.people);expect(inspected.manifest.misskey).toEqual(f.config.misskey);
    await publishEnvironmentPackage(inspected,target);
    const restarted:EnvironmentStores={avatars:new AvatarStore(directory),studios:new StudioStore(directory)};
    expect((await restarted.studios.bundle(f.model.bundleId)).entry).toBe('models/stage.gltf');
    expect((await restarted.studios.file(f.model.bundleId,'models/stage.gltf')).bytes).toEqual(new Uint8Array(f.modelBytes));
    expect((await restarted.avatars.get(f.backImage.assetId)).info.assetId).toBe(f.backImage.assetId);
    expect((await restarted.avatars.get(f.iconId)).info.mime).toBe('image/png');
    expect((await restarted.avatars.gaussian.asset(f.gaussian.assetId)).manifest).toEqual(f.gaussian.manifest);
    expect(inspected.manifest.preset.avatarProfiles[1]).toMatchObject({assetId:f.gaussian.assetId,manifest:{normalization:{rotation:[0,.3,0]}}});
    expect((await collectEnvironmentPackage(f.config,restarted)).manifest).toEqual(content.manifest);
    // Repeated import is content-addressed and does not duplicate assets.
    await publishEnvironmentPackage(inspected,restarted);expect(await restarted.studios.list()).toHaveLength(1);expect(await restarted.avatars.gaussian.list()).toHaveLength(1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('export collects fresh icon bytes without modifying the source store and fails when a required source is absent',async()=>{
  const f=await fixture();await collectEnvironmentPackage(f.config,f.stores,f.extra);
  await expect(f.stores.avatars.get(f.iconId)).rejects.toThrow('ASSET_NOT_FOUND');
  await expect(collectEnvironmentPackage(f.config,f.stores)).rejects.toThrow('ASSET_NOT_FOUND');
  await expect(collectEnvironmentPackage(f.config,f.stores,new Map([[f.iconId,new Uint8Array([1])]]))).rejects.toThrow('ENVIRONMENT_BLOB_CORRUPT');
});

test('inspection rejects missing/extra references, corrupt hashes, forged bundle IDs and unexpected manifest fields',async()=>{
  const f=await fixture(),base=await collectEnvironmentPackage(f.config,f.stores,f.extra);
  const missing=structuredClone(base);missing.blobs.delete(f.image.assetId);
  await expect(inspectEnvironmentPackage(unsafeArchive(missing))).rejects.toThrow('ENVIRONMENT_REFERENCE_MISMATCH');
  const extra=structuredClone(base),bytes=json({unrelated:true}),id=await environmentHash(bytes);extra.blobs.set(id,bytes);extra.manifest.blobs.push({sha256:id,byteLength:bytes.length});
  await expect(inspectEnvironmentPackage(unsafeArchive(extra))).rejects.toThrow('ENVIRONMENT_REFERENCE_MISMATCH');
  const corrupt=structuredClone(base),source=corrupt.blobs.get(f.image.assetId)!;source[0]=0;
  await expect(inspectEnvironmentPackage(unsafeArchive(corrupt))).rejects.toThrow('ENVIRONMENT_BLOB_CORRUPT');
  const forged=structuredClone(base),oldId=forged.manifest.studios[0]!.bundleId,newId='f'.repeat(64);forged.manifest.studios[0]!.bundleId=newId;
  for(const object of forged.manifest.preset.studio.objects)if(object.kind==='model'&&object.bundleId===oldId)object.bundleId=newId;
  await expect(inspectEnvironmentPackage(unsafeArchive(forged))).rejects.toThrow('ENVIRONMENT_ASSET_ID_MISMATCH');
  const unexpected=structuredClone(base);Object.assign(unexpected.manifest,{discordToken:'not-a-real-token'});
  await expect(inspectEnvironmentPackage(unsafeArchive(unexpected))).rejects.toThrow('ENVIRONMENT_MANIFEST_INVALID');
});

test('materialized IDs and image dimensions are verified before publishing any live assets',async()=>{
  const f=await fixture(),content=await collectEnvironmentPackage(f.config,f.stores,f.extra),target:EnvironmentStores={avatars:new AvatarStore(),studios:new StudioStore()};
  const badDimensions=structuredClone(content),profile=badDimensions.manifest.preset.avatarProfiles[0]!;
  if(profile.kind!=='gaussian')profile.image.width+=1;
  await expect(publishEnvironmentPackage(badDimensions,target)).rejects.toThrow('ENVIRONMENT_PROFILE_ASSET_MISMATCH');
  expect(await target.studios.list()).toEqual([]);await expect(target.avatars.get(f.image.assetId)).rejects.toThrow('ASSET_NOT_FOUND');
  const forged=structuredClone(content),gaussian=forged.manifest.gaussians[0]!,originalId=gaussian.assetId;gaussian.assetId='e'.repeat(64);
  for(const p of forged.manifest.preset.avatarProfiles)if(p.kind==='gaussian'&&p.assetId===originalId)p.assetId=gaussian.assetId;
  await expect(publishEnvironmentPackage(forged,target)).rejects.toThrow('ENVIRONMENT_ASSET_ID_MISMATCH');expect(await target.studios.list()).toEqual([]);
});

test('a missing GLTF dependency is rejected even if blob hashes and the outer reference closure agree',async()=>{
  const f=await fixture(),content=await collectEnvironmentPackage(f.config,f.stores,f.extra),model=content.manifest.studios[0]!,removed=model.files.find(file=>file.path==='shared/mesh.bin')!;
  model.files=model.files.filter(file=>file!==removed);content.blobs.delete(removed.blob);content.manifest.blobs=content.manifest.blobs.filter(blob=>blob.sha256!==removed.blob);
  await expect(inspectEnvironmentPackage(unsafeArchive(content))).rejects.toThrow('STUDIO_DEPENDENCY_MISSING');
});

test('package validation enforces the shared source splat budget for all saved assignments',async()=>{
  const config=configuration(),stores:EnvironmentStores={avatars:new AvatarStore(),studios:new StudioStore()},source=await stores.avatars.gaussian.importRaw({path:'million.spz',bytes:gaussianSpz(1,1_000_000)});
  const profile=await stores.avatars.validateDraft({kind:'gaussian',userId:'1',assetId:source.assetId,manifest:source.manifest,scale:1,offsetX:0,offsetY:0});
  config.preset.avatarProfiles=Array.from({length:9},(_,i)=>({...profile,userId:String(100+i)}));
  await expect(collectEnvironmentPackage(config,stores)).rejects.toThrow('GAUSSIAN_ACTIVE_SPLAT_LIMIT');
  expect(await stores.avatars.gaussian.list()).toHaveLength(1);
});

test('post-publish reads reject an already-corrupted content-addressed target instead of making its settings active',async()=>{
  const f=await fixture(),content=await collectEnvironmentPackage(f.config,f.stores,f.extra),directory=await mkdtemp(join(tmpdir(),'entaku-environment-corrupt-'));
  try{
    const stores:EnvironmentStores={avatars:new AvatarStore(directory),studios:new StudioStore(directory)};await publishEnvironmentPackage(content,stores);
    await writeFile(join(directory,'assets','avatars',f.image.assetId),new Uint8Array([1]));
    await expect(publishEnvironmentPackage(content,stores)).rejects.toThrow('ASSET_NOT_FOUND');
  }finally{await rm(directory,{recursive:true,force:true});}
});
