import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Unzip,UnzipInflate,unzipSync,zipSync} from 'fflate';
import {inspectGltfEntry} from '../studio/gltf.ts';
import {inspectImage} from './image.ts';
import {GAUSSIAN_LIMITS,safeGaussianPath,validateGaussianManifest,type GaussianAvatarManifest,type GaussianAvatarProfile} from './gaussian-profile.ts';
import {inspectGaussianSource,type GaussianSourceInfo} from './gaussian-format.ts';
export interface GaussianFile {path:string;bytes:Uint8Array}
export interface StoredGaussianAsset {
  schemaVersion:1;assetId:string;manifest:GaussianAvatarManifest;
  files:Array<{path:string;hash:string;byteLength:number;mime:string}>;
  byteLength:number;splatCount:number;format:'ply'|'spz';
}
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const validId=(id:string)=>/^[a-f0-9]{64}$/.test(id);
const mime=(path:string)=>({json:'application/json',spz:'application/octet-stream',ply:'application/octet-stream',glb:'model/gltf-binary',bin:'application/octet-stream',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',ktx2:'image/ktx2'}[path.split('.').at(-1)?.toLowerCase()??'']);
const compare=(a:{path:string},b:{path:string})=>a.path<b.path?-1:a.path>b.path?1:0;
async function bounded(path:string,max:number):Promise<Uint8Array>{
  const info=await lstat(path);if(!info.isFile()||info.size>max)throw new Error('GAUSSIAN_FILE_REJECTED');
  const bytes=await readFile(path);if(bytes.byteLength!==info.size||bytes.byteLength>max)throw new Error('GAUSSIAN_FILE_REJECTED');return bytes;
}
/** Inflate limits count actual output, not just attacker-controlled ZIP headers.
 * Members are stored by hash; a member name never becomes a filesystem path. */
export function unpackGaussianZip(bytes:Uint8Array):GaussianFile[]{
  if(bytes.byteLength>GAUSSIAN_LIMITS.archiveBytes)throw new Error('GAUSSIAN_ARCHIVE_TOO_LARGE');
  const declared=new Map<string,number>();let entries=0,declaredBytes=0;
  // fflate's streaming reader consumes local entries only. Its central-directory
  // reader validates that the archive has a complete end record without inflating.
  try{unzipSync(bytes,{filter:file=>{
    if(++entries>GAUSSIAN_LIMITS.files)throw new Error('GAUSSIAN_FILE_LIMIT');
    const path=safeGaussianPath(file.name.endsWith('/')?file.name.slice(0,-1):file.name);
    if(file.name.endsWith('/'))return false;
    if(declared.has(path))throw new Error('GAUSSIAN_DUPLICATE_PATH');
    if(file.originalSize>(path==='manifest.json'?GAUSSIAN_LIMITS.manifestBytes:GAUSSIAN_LIMITS.fileBytes))throw new Error('GAUSSIAN_FILE_TOO_LARGE');
    declaredBytes+=file.originalSize;if(declaredBytes>GAUSSIAN_LIMITS.unpackedBytes)throw new Error('GAUSSIAN_ARCHIVE_TOO_LARGE');
    declared.set(path,file.originalSize);return false;
  }});}catch(e){throw e instanceof Error&&e.message.startsWith('GAUSSIAN_')?e:new Error('GAUSSIAN_ARCHIVE_INVALID');}
  const files:GaussianFile[]=[],names=new Set<string>();let total=0,pending=0,failure:Error|null=null,localEntries=0;
  const archive=new Unzip(file=>{
    if(++localEntries>GAUSSIAN_LIMITS.files)throw new Error('GAUSSIAN_FILE_LIMIT');
    if(file.name.endsWith('/')){safeGaussianPath(file.name.slice(0,-1));return;}
    const path=safeGaussianPath(file.name);
    if(!declared.has(path))throw new Error('GAUSSIAN_ARCHIVE_INVALID');
    if(names.has(path))throw new Error('GAUSSIAN_DUPLICATE_PATH');
    if(names.size>=GAUSSIAN_LIMITS.files)throw new Error('GAUSSIAN_FILE_LIMIT');names.add(path);
    const limit=path==='manifest.json'?GAUSSIAN_LIMITS.manifestBytes:GAUSSIAN_LIMITS.fileBytes;
    if(file.originalSize!==undefined&&file.originalSize>limit)throw new Error('GAUSSIAN_FILE_TOO_LARGE');
    const chunks:Uint8Array[]=[];let size=0;pending++;
    file.ondata=(error,chunk,final)=>{
      if(failure){file.terminate();return;}if(error){failure=new Error('GAUSSIAN_ARCHIVE_INVALID');return;}
      size+=chunk.length;total+=chunk.length;
      if(size>limit||total>GAUSSIAN_LIMITS.unpackedBytes){failure=new Error('GAUSSIAN_ARCHIVE_TOO_LARGE');file.terminate();return;}
      chunks.push(chunk);if(final){if(size!==declared.get(path)){failure=new Error('GAUSSIAN_ARCHIVE_INVALID');return;}const output=new Uint8Array(size);let at=0;for(const c of chunks){output.set(c,at);at+=c.length;}files.push({path,bytes:output});pending--;}
    };file.start();
  });archive.register(UnzipInflate);
  try{for(let offset=0;offset<bytes.length;offset+=4096){archive.push(bytes.subarray(offset,offset+4096),offset+4096>=bytes.length);if(failure)throw failure;}}
  catch(e){throw e instanceof Error&&e.message.startsWith('GAUSSIAN_')?e:new Error('GAUSSIAN_ARCHIVE_INVALID');}
  if(failure)throw failure;if(pending||!files.length||files.length!==declared.size)throw new Error('GAUSSIAN_ARCHIVE_INVALID');return files;
}
/** A raw upload starts with editable calibration. The detected point envelope
 * estimates scale only; a user must check the face and source axes in preview. */
export function defaultGaussianManifest(splat:string,source?:GaussianSourceInfo):GaussianAvatarManifest{
  const b=source?.bounds??{min:[-.3,0,-.15],max:[.3,1.6,.15]};
  const width=b.max[0]!-b.min[0]!,height=b.max[1]!-b.min[1]!,depth=b.max[2]!-b.min[2]!;
  const scale=Math.min(1.6/height,1.6/width,1/depth),cx=(b.min[0]!+b.max[0]!)/2,cz=(b.min[2]!+b.max[2]!)/2;
  const halfWidth=Math.max(.16,width*scale/2+.03),halfDepth=Math.max(.12,depth*scale/2+.03),top=Math.max(.32,height*scale+.03),faceY=top-.15;
  return {schemaVersion:1,kind:'entaku-gaussian-avatar',name:splat.replace(/\.[^.]+$/,'').slice(0,80)||'3DGS avatar',splat,
    coordinates:{units:'m',up:'+Y',forward:'+Z'},normalization:{scale,rotation:[0,0,0],translation:[-cx*scale,-b.min[1]!*scale,-cz*scale]},
    faceAnchor:[0,faceY,0],faceBounds:{min:[-.14,faceY-.14,-.1],max:[.14,faceY+.14,.1]},
    bodyBounds:{min:[-halfWidth,-.03,-halfDepth],max:[halfWidth,top,halfDepth]},framingBounds:{min:[-halfWidth,-.03,-halfDepth],max:[halfWidth,top,halfDepth]}};
}
/** Immutable character packages; participant assignments stay in avatars.json. */
export class GaussianStore {
  private assets=new Map<string,StoredGaussianAsset>();private data=new Map<string,Uint8Array>();
  constructor(private directory:string|null=null){}
  async importZip(bytes:Uint8Array):Promise<StoredGaussianAsset>{return this.importFiles(unpackGaussianZip(bytes));}
  async importRaw(splat:GaussianFile,extras:GaussianFile[]=[],manifest?:unknown):Promise<StoredGaussianAsset>{
    const source=inspectGaussianSource(splat.bytes,splat.path);
    const draft=manifest??{...defaultGaussianManifest(splat.path,source),...(extras.find(f=>/\.glb$/i.test(f.path))?{proxy:extras.find(f=>/\.glb$/i.test(f.path))!.path}:{}),...(extras.find(f=>/\.png$/i.test(f.path))?{preview:extras.find(f=>/\.png$/i.test(f.path))!.path}:{})};
    return this.importFiles([{path:'manifest.json',bytes:new TextEncoder().encode(JSON.stringify(draft))},splat,...extras]);
  }
  async importFiles(input:readonly GaussianFile[]):Promise<StoredGaussianAsset>{
    if(!input.length||input.length>GAUSSIAN_LIMITS.files)throw new Error('GAUSSIAN_FILE_LIMIT');
    const files=new Map<string,Uint8Array>();let total=0;
    for(const item of input){const path=safeGaussianPath(item.path);if(files.has(path))throw new Error('GAUSSIAN_DUPLICATE_PATH');if(!mime(path))throw new Error('GAUSSIAN_FILE_FORMAT_REJECTED');
      if(item.bytes.length>(path==='manifest.json'?GAUSSIAN_LIMITS.manifestBytes:GAUSSIAN_LIMITS.fileBytes))throw new Error('GAUSSIAN_FILE_TOO_LARGE');total+=item.bytes.length;
      if(total>GAUSSIAN_LIMITS.unpackedBytes)throw new Error('GAUSSIAN_ARCHIVE_TOO_LARGE');files.set(path,item.bytes);}
    const rawManifest=files.get('manifest.json');if(!rawManifest)throw new Error('GAUSSIAN_MANIFEST_MISSING');
    let manifest:GaussianAvatarManifest;try{manifest=validateGaussianManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawManifest)));}catch(e){throw e instanceof Error&&e.message.startsWith('GAUSSIAN_')?e:new Error('GAUSSIAN_MANIFEST_INVALID');}
    const source=files.get(manifest.splat);if(!source)throw new Error('GAUSSIAN_REFERENCE_MISSING');const info=inspectGaussianSource(source,manifest.splat);
    const referenced=new Set(['manifest.json',manifest.splat]);
    if(manifest.proxy){const proxy=files.get(manifest.proxy);if(!proxy)throw new Error('GAUSSIAN_REFERENCE_MISSING');referenced.add(manifest.proxy);
      let doc;try{doc=inspectGltfEntry(proxy,manifest.proxy);}catch{throw new Error('GAUSSIAN_PROXY_INVALID');}
      for(const path of doc.externalPaths){if(!files.has(path))throw new Error('GAUSSIAN_REFERENCE_MISSING');referenced.add(path);}}
    if(manifest.preview){const preview=files.get(manifest.preview);if(!preview)throw new Error('GAUSSIAN_REFERENCE_MISSING');try{if(inspectImage(preview).mime!=='image/png')throw new Error();}catch{throw new Error('GAUSSIAN_PREVIEW_INVALID');}referenced.add(manifest.preview);}
    if([...files.keys()].some(p=>!referenced.has(p)))throw new Error('GAUSSIAN_UNREFERENCED_FILE');
    files.set('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));
    const metadata=[...files].map(([path,bytes])=>({path,hash:hash(bytes),byteLength:bytes.length,mime:mime(path)!})).sort(compare);
    const assetId=hash(JSON.stringify({manifest,files:metadata}));total=metadata.reduce((s,f)=>s+f.byteLength,0);
    const asset:StoredGaussianAsset={schemaVersion:1,assetId,manifest,files:metadata,byteLength:total,splatCount:info.splatCount,format:info.format};
    const existing=await this.list();
    if(!existing.some(a=>a.assetId===assetId)&&(existing.length>=GAUSSIAN_LIMITS.storeAssets||existing.reduce((s,a)=>s+a.byteLength,0)+total>GAUSSIAN_LIMITS.storeBytes))throw new Error('GAUSSIAN_STORE_FULL');
    if(this.directory){const root=join(this.directory,'assets','gaussians'),pending=join(root,'.pending-'+randomUUID());await mkdir(root,{recursive:true,mode:0o700});
      if(!existing.some(a=>a.assetId===assetId)){try{await mkdir(pending,{mode:0o700});for(const f of metadata)await writeFile(join(pending,f.hash),files.get(f.path)!,{mode:0o600});await writeFile(join(pending,'asset.json'),JSON.stringify(asset),{mode:0o600});await rename(pending,join(root,assetId));}finally{await rm(pending,{recursive:true,force:true});}}}
    else for(const f of metadata)this.data.set(`${assetId}/${f.hash}`,files.get(f.path)!.slice());
    this.assets.set(assetId,asset);return structuredClone(asset);
  }
  async list():Promise<StoredGaussianAsset[]>{
    if(this.directory){const root=join(this.directory,'assets','gaussians');await mkdir(root,{recursive:true,mode:0o700});const names=(await readdir(root)).filter(validId);if(names.length>GAUSSIAN_LIMITS.storeAssets)throw new Error('GAUSSIAN_STORE_FULL');for(const name of names)await this.asset(name);}
    return structuredClone([...this.assets.values()]);
  }
  async asset(id:string):Promise<StoredGaussianAsset>{
    if(!validId(id))throw new Error('GAUSSIAN_ASSET_NOT_FOUND');const cached=this.assets.get(id);if(cached)return structuredClone(cached);if(!this.directory)throw new Error('GAUSSIAN_ASSET_NOT_FOUND');
    try{const a:StoredGaussianAsset=JSON.parse(new TextDecoder().decode(await bounded(join(this.directory,'assets','gaussians',id,'asset.json'),256*1024)));a.manifest=validateGaussianManifest(a.manifest);
      if(a.schemaVersion!==1||a.assetId!==id||!Array.isArray(a.files)||a.files.length<2||a.files.length>GAUSSIAN_LIMITS.files||!['spz','ply'].includes(a.format)||!Number.isSafeInteger(a.splatCount)||a.splatCount<1||a.splatCount>GAUSSIAN_LIMITS.splats)throw new Error();
      if(a.files.some(f=>safeGaussianPath(f.path)!==f.path||!validId(f.hash)||!Number.isSafeInteger(f.byteLength)||f.byteLength<0||f.byteLength>GAUSSIAN_LIMITS.fileBytes||mime(f.path)!==f.mime)||new Set(a.files.map(f=>f.path)).size!==a.files.length)throw new Error();
      if(a.byteLength!==a.files.reduce((s,f)=>s+f.byteLength,0)||a.byteLength>GAUSSIAN_LIMITS.unpackedBytes||hash(JSON.stringify({manifest:a.manifest,files:a.files}))!==id)throw new Error();
      for(const p of ['manifest.json',a.manifest.splat,a.manifest.proxy,a.manifest.preview].filter(p=>p!==undefined))if(!a.files.some(f=>f.path===p))throw new Error();
      this.assets.set(id,a);return structuredClone(a);
    }catch{throw new Error('GAUSSIAN_ASSET_NOT_FOUND');}
  }
  async file(id:string,path:string):Promise<{bytes:Uint8Array;mime:string}>{
    const a=await this.asset(id),f=a.files.find(f=>f.path===path);if(!f)throw new Error('GAUSSIAN_FILE_NOT_FOUND');
    const bytes=this.directory?await bounded(join(this.directory,'assets','gaussians',id,f.hash),GAUSSIAN_LIMITS.fileBytes):this.data.get(`${id}/${f.hash}`);
    if(!bytes||bytes.length!==f.byteLength||hash(bytes)!==f.hash)throw new Error('GAUSSIAN_FILE_CORRUPT');return {bytes:bytes.slice(),mime:f.mime};
  }
  async validateProfileAssets(profile:GaussianAvatarProfile):Promise<void>{
    const asset=await this.asset(profile.assetId),m=profile.manifest;
    if(m.splat!==asset.manifest.splat||m.proxy!==asset.manifest.proxy||m.preview!==asset.manifest.preview)throw new Error('GAUSSIAN_REFERENCE_INVALID');
    for(const file of asset.files)await this.file(asset.assetId,file.path);
  }
  async exportZip(id:string,override?:unknown):Promise<Uint8Array>{
    const a=await this.asset(id),manifest=override===undefined?a.manifest:validateGaussianManifest(override);
    if(manifest.splat!==a.manifest.splat||manifest.proxy!==a.manifest.proxy||manifest.preview!==a.manifest.preview)throw new Error('GAUSSIAN_REFERENCE_INVALID');
    const files:Record<string,Uint8Array>={};for(const f of a.files)files[f.path]=(await this.file(id,f.path)).bytes;
    files['manifest.json']=new TextEncoder().encode(JSON.stringify(manifest,null,2));const output=zipSync(files,{level:1});if(output.length>GAUSSIAN_LIMITS.archiveBytes)throw new Error('GAUSSIAN_ARCHIVE_TOO_LARGE');return output;
  }
}
