import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AvatarStore} from '../assets/store.ts';
import {isGaussianProfile} from '../assets/avatar-profile.ts';
import {safeGaussianPath} from '../assets/gaussian-profile.ts';
import {StudioStore} from '../studio/store.ts';
import {safeStudioPath} from '../studio/manifest.ts';
import {validatePreset} from '../presets/schema.ts';
import {validateMisskeySettings} from '../misskey/settings.ts';
import {validateNoteIntroductionSettings} from '../note-introduction/settings.ts';
import {environmentHash,packEnvironmentArchive,unpackEnvironmentArchive} from './archive.ts';
import {ENVIRONMENT_LIMITS as limits,validateEnvironmentPeople,type EnvironmentConfiguration,type EnvironmentFileReference,type EnvironmentPackageManifest,type EnvironmentPackageSummary} from './types.ts';

export interface EnvironmentStores {studios:StudioStore;avatars:AvatarStore}
export interface EnvironmentContent {manifest:EnvironmentPackageManifest;blobs:Map<string,Uint8Array>}
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const validHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(code='MANIFEST_INVALID'):never=>{throw new Error(`ENVIRONMENT_${code}`);};
function shape(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))return fail();
  return value as Record<string,unknown>;
}
function configuration(value:unknown):EnvironmentConfiguration {
  const v=value as EnvironmentConfiguration;
  if(!v||typeof v!=='object'||typeof v.appVersion!=='string'||!v.appVersion||v.appVersion.length>128||/[\x00-\x1f\x7f]/.test(v.appVersion)||
    typeof v.createdAt!=='string'||v.createdAt.length>40||!Number.isFinite(Date.parse(v.createdAt)))return fail();
  return {appVersion:v.appVersion,createdAt:v.createdAt,preset:validatePreset(v.preset),misskey:validateMisskeySettings(v.misskey),people:validateEnvironmentPeople(v.people),
    ...(v.noteIntroduction===undefined?{}:{noteIntroduction:validateNoteIntroductionSettings(v.noteIntroduction)})};
}
function references(value:EnvironmentConfiguration) {
  const images=new Set<string>(),studios=new Set<string>(),gaussians=new Set<string>();
  for(const object of value.preset.studio.objects)if(object.kind==='model')studios.add(object.bundleId);
  for(const profile of value.preset.avatarProfiles){
    if(isGaussianProfile(profile))gaussians.add(profile.assetId);
    else{images.add(profile.assetId);if(profile.back)images.add(profile.back.assetId);}
  }
  for(const person of value.people.identities)if(person.iconAssetId)images.add(person.iconAssetId);
  return {images,studios,gaussians};
}
function sameSet(actual:readonly string[],wanted:ReadonlySet<string>):void {
  if(new Set(actual).size!==actual.length||actual.length!==wanted.size||actual.some(id=>!wanted.has(id)))return fail('REFERENCE_MISMATCH');
}
function fileReferences(value:unknown,maximum:number,safePath:(path:string)=>string):EnvironmentFileReference[] {
  if(!Array.isArray(value)||!value.length||value.length>maximum)return fail('FILE_LIMIT');
  const paths=new Set<string>();
  return value.map(item=>{
    const f=shape(item,['path','blob']);
    if(typeof f.path!=='string'||!validHash(f.blob))return fail();
    const path=safePath(f.path);if(paths.has(path))return fail('DUPLICATE_PATH');paths.add(path);
    return {path,blob:f.blob};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function manifest(value:unknown):EnvironmentPackageManifest {
  const v=shape(value,['schemaVersion','kind','appVersion','createdAt','preset','misskey','people','noteIntroduction','images','studios','gaussians','blobs']);
  if(v.schemaVersion!==1||v.kind!=='entaku-environment')return fail();
  const config=configuration(value),required=references(config);
  if(!Array.isArray(v.images)||v.images.length>256||v.images.some(id=>!validHash(id))||
    !Array.isArray(v.studios)||v.studios.length>32||!Array.isArray(v.gaussians)||v.gaussians.length>128||
    !Array.isArray(v.blobs)||v.blobs.length+1>limits.files)return fail('FILE_LIMIT');
  const images=(v.images as string[]).slice().sort();
  const studios=v.studios.map(item=>{
    const s=shape(item,['bundleId','entry','files']);
    if(!validHash(s.bundleId)||typeof s.entry!=='string')return fail();
    return {bundleId:s.bundleId,entry:safeStudioPath(s.entry),files:fileReferences(s.files,256,safeStudioPath)};
  }).sort((a,b)=>a.bundleId.localeCompare(b.bundleId));
  const gaussians=v.gaussians.map(item=>{
    const g=shape(item,['assetId','files']);if(!validHash(g.assetId))return fail();
    return {assetId:g.assetId,files:fileReferences(g.files,64,safeGaussianPath)};
  }).sort((a,b)=>a.assetId.localeCompare(b.assetId));
  sameSet(images,required.images);sameSet(studios.map(s=>s.bundleId),required.studios);sameSet(gaussians.map(g=>g.assetId),required.gaussians);
  const used=new Set(images);for(const asset of [...studios,...gaussians])for(const file of asset.files)used.add(file.blob);
  let total=0;
  const blobs=v.blobs.map(item=>{
    const b=shape(item,['sha256','byteLength']);
    if(!validHash(b.sha256)||typeof b.byteLength!=='number'||!Number.isSafeInteger(b.byteLength)||b.byteLength<0||b.byteLength>limits.fileBytes)return fail('FILE_TOO_LARGE');
    total+=b.byteLength;if(total>limits.unpackedBytes)return fail('ARCHIVE_TOO_LARGE');
    return {sha256:b.sha256,byteLength:b.byteLength};
  }).sort((a,b)=>a.sha256.localeCompare(b.sha256));
  sameSet(blobs.map(b=>b.sha256),used);
  const clean:EnvironmentPackageManifest={schemaVersion:1,kind:'entaku-environment',...config,images,studios,gaussians,blobs};
  const size=encode(clean).length;if(size>limits.manifestBytes)return fail('MANIFEST_TOO_LARGE');
  if(total+size>limits.unpackedBytes)return fail('ARCHIVE_TOO_LARGE');return clean;
}
/** Structural closure and actual hashes are checked again at each public boundary. */
async function validateContent(input:EnvironmentContent):Promise<EnvironmentContent> {
  if(!input||!(input.blobs instanceof Map))return fail();
  const clean=manifest(input.manifest),blobs=new Map(input.blobs);
  sameSet([...blobs.keys()],new Set(clean.blobs.map(b=>b.sha256)));
  for(const b of clean.blobs){
    const bytes=blobs.get(b.sha256);
    if(!(bytes instanceof Uint8Array)||bytes.length!==b.byteLength||await environmentHash(bytes)!==b.sha256)return fail('BLOB_CORRUPT');
  }
  return {manifest:clean,blobs};
}
const assetFiles=(files:readonly EnvironmentFileReference[],content:EnvironmentContent)=>files.map(f=>({path:f.path,bytes:content.blobs.get(f.blob)!}));
function verifyFileIds(actual:readonly {path:string;hash:string}[],expected:readonly EnvironmentFileReference[]):void {
  const byPath=new Map(actual.map(f=>[f.path,f.hash]));
  if(byPath.size!==expected.length||expected.some(f=>byPath.get(f.path)!==f.blob))return fail('ASSET_ID_MISMATCH');
}
async function importAssets(content:EnvironmentContent,stores:EnvironmentStores):Promise<void> {
  const m=content.manifest;
  for(const id of m.images)if((await stores.avatars.importImage(content.blobs.get(id)!)).assetId!==id)return fail('ASSET_ID_MISMATCH');
  for(const s of m.studios){
    const actual=await stores.studios.importFiles(assetFiles(s.files,content),s.entry);
    if(actual.bundleId!==s.bundleId||actual.entry!==s.entry)return fail('ASSET_ID_MISMATCH');verifyFileIds(actual.files,s.files);
  }
  for(const g of m.gaussians){
    const actual=await stores.avatars.gaussian.importFiles(assetFiles(g.files,content));
    if(actual.assetId!==g.assetId)return fail('ASSET_ID_MISMATCH');verifyFileIds(actual.files,g.files);
  }
}
async function validateStored(content:EnvironmentContent,stores:EnvironmentStores):Promise<void> {
  const m=content.manifest;
  for(const id of m.images)await stores.avatars.get(id);
  for(const s of m.studios){
    const actual=await stores.studios.bundle(s.bundleId);if(actual.entry!==s.entry)return fail('ASSET_ID_MISMATCH');verifyFileIds(actual.files,s.files);
    for(const f of s.files)await stores.studios.file(s.bundleId,f.path);
  }
  for(const g of m.gaussians){verifyFileIds((await stores.avatars.gaussian.asset(g.assetId)).files,g.files);for(const f of g.files)await stores.avatars.gaussian.file(g.assetId,f.path);}
  await stores.studios.validateDraft(m.preset.studio);
  const profiles=[];
  for(const profile of m.preset.avatarProfiles){
    const checked=await stores.avatars.validateDraft(profile);
    if(JSON.stringify(checked)!==JSON.stringify(profile))return fail('PROFILE_ASSET_MISMATCH');profiles.push(checked);
  }
  await stores.avatars.validateProfiles(profiles);
}
async function validateDetached(content:EnvironmentContent):Promise<void> {
  // Disk-backed validation uses the production quotas (the safe-mode memory
  // image store is intentionally smaller) and never writes to the live stores.
  const directory=await mkdtemp(join(tmpdir(),'entaku-environment-check-'));
  try{
    const stores:EnvironmentStores={studios:new StudioStore(directory),avatars:new AvatarStore(directory)};
    await stores.studios.initialize();await stores.avatars.initialize();await importAssets(content,stores);await validateStored(content,stores);
  }finally{await rm(directory,{recursive:true,force:true});}
}

/** Collect only active references, keeping each bundle's original paths and
 * immutable Gaussian manifest. Per-person calibration stays in the preset. */
export async function collectEnvironmentPackage(input:EnvironmentConfiguration,stores:EnvironmentStores,extraImages:ReadonlyMap<string,Uint8Array>=new Map()):Promise<EnvironmentContent> {
  shape(input,['appVersion','createdAt','preset','misskey','people','noteIntroduction']);
  const config=configuration(input),required=references(config),blobs=new Map<string,Uint8Array>();
  if(required.images.size>256||required.studios.size>32||required.gaussians.size>128)return fail('FILE_LIMIT');
  if([...extraImages.keys()].some(id=>!required.images.has(id)))return fail('REFERENCE_MISMATCH');
  let total=0;
  const add=async(id:string,bytes:Uint8Array)=>{
    if(!(bytes instanceof Uint8Array)||bytes.length>limits.fileBytes)return fail('FILE_TOO_LARGE');
    if(!blobs.has(id)){if(blobs.size+2>limits.files)return fail('FILE_LIMIT');total+=bytes.length;if(total>limits.unpackedBytes)return fail('ARCHIVE_TOO_LARGE');}
    if(!validHash(id)||await environmentHash(bytes)!==id)return fail('BLOB_CORRUPT');if(!blobs.has(id))blobs.set(id,bytes);
  };
  const images=[...required.images].sort();
  for(const id of images)await add(id,extraImages.get(id)??(await stores.avatars.get(id)).bytes);
  const studios:EnvironmentPackageManifest['studios']=[];
  for(const id of [...required.studios].sort()){
    const asset=await stores.studios.bundle(id),files:EnvironmentFileReference[]=[];
    for(const f of asset.files){await add(f.hash,(await stores.studios.file(id,f.path)).bytes);files.push({path:f.path,blob:f.hash});}
    studios.push({bundleId:id,entry:asset.entry,files});
  }
  const gaussians:EnvironmentPackageManifest['gaussians']=[];
  for(const id of [...required.gaussians].sort()){
    const asset=await stores.avatars.gaussian.asset(id),files:EnvironmentFileReference[]=[];
    for(const f of asset.files){await add(f.hash,(await stores.avatars.gaussian.file(id,f.path)).bytes);files.push({path:f.path,blob:f.hash});}
    gaussians.push({assetId:id,files});
  }
  const content=await validateContent({manifest:{schemaVersion:1,kind:'entaku-environment',...config,images,studios,gaussians,blobs:[...blobs].map(([sha256,bytes])=>({sha256,byteLength:bytes.length}))},blobs});
  await validateDetached(content);return content;
}

export async function exportEnvironmentPackage(input:EnvironmentContent):Promise<Uint8Array> {
  const content=await validateContent(input),files=new Map<string,Uint8Array>([['entaku.json',encode(content.manifest)]]);
  for(const b of content.manifest.blobs)files.set(`assets/${b.sha256}`,content.blobs.get(b.sha256)!);
  return packEnvironmentArchive(files);
}

export async function inspectEnvironmentPackage(bytes:Uint8Array):Promise<{content:EnvironmentContent;summary:EnvironmentPackageSummary}> {
  const files=await unpackEnvironmentArchive(bytes),raw=files.get('entaku.json');if(!raw)return fail('MANIFEST_MISSING');
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return fail();}
  const content=await validateContent({manifest:value as EnvironmentPackageManifest,blobs:new Map([...files].filter(([path])=>path!=='entaku.json').map(([path,data])=>[path.slice(7),data]))});
  await validateDetached(content);
  const m=content.manifest;
  return {content,summary:{appVersion:m.appVersion,createdAt:m.createdAt,sha256:await environmentHash(bytes),archiveBytes:bytes.length,
    unpackedBytes:[...files.values()].reduce((total,data)=>total+data.length,0),
    counts:{studioBundles:m.studios.length,images:m.images.length,gaussians:m.gaussians.length,people:m.people.identities.length,files:files.size},theme:m.preset.theme}};
}

/** Only immutable assets are published here. The service owns the guarded,
 * atomic settings/roster commit after this promise succeeds. */
export async function publishEnvironmentPackage(input:EnvironmentContent,stores:EnvironmentStores):Promise<void> {
  const content=await validateContent(input);await validateDetached(content);
  await importAssets(content,stores);await validateStored(content,stores);
}
