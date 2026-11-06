import { safeStudioPath, studioAssetUrlAllowed } from './manifest.ts';

export interface GLTFDocument {
  source: 'gltf' | 'glb';
  json: Record<string,unknown>;
  externalPaths: string[];
  requiredExtensions: string[];
}
const object=(v:unknown): Record<string,unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('STUDIO_GLTF_INVALID');
  return v as Record<string,unknown>;
};
const asArray=(v:unknown): unknown[]=> {
  if (v===undefined) return [];
  if(!Array.isArray(v))throw new Error('STUDIO_GLTF_INVALID');
  return v;
};
function inspect(jsonText:string, entryPath:string, source:GLTFDocument['source']):GLTFDocument {
  if(jsonText.length>4*1024*1024)throw new Error('STUDIO_GLTF_INVALID');
  let j: Record<string,unknown>;
  try{j=object(JSON.parse(jsonText));}catch{throw new Error('STUDIO_GLTF_INVALID');}
  const asset=object(j.asset);
  if(asset.version!=='2.0')throw new Error('STUDIO_GLTF_VERSION_UNSUPPORTED');
  const required=asArray(j.extensionsRequired);
  // Format extensions belong to GLTFLoader (with its optional decoders), not this importer.
  if(required.some(v=>typeof v!=='string'))throw new Error('STUDIO_GLTF_INVALID');
  const externalPaths=new Set<string>();
  for(const collection of ['buffers','images']){
    for(const value of asArray(j[collection])){
      const row=object(value),uri=row.uri;
      if(uri===undefined)continue;
      if(typeof uri!=='string')throw new Error('STUDIO_GLTF_INVALID');
      if(studioAssetUrlAllowed(uri))continue;
      externalPaths.add(resolveStudioReference(entryPath,uri));
    }
  }
  return {source,json:j,externalPaths:[...externalPaths].sort(),requiredExtensions:required as string[]};
}
export function inspectGltfEntry(bytes:Uint8Array,entryPath:string):GLTFDocument {
  safeStudioPath(entryPath);
  if(!/\.gltf$|\.glb$/i.test(entryPath))throw new Error('STUDIO_GLTF_INVALID');
  if(bytes.byteLength>32*1024*1024)throw new Error('STUDIO_GLTF_INVALID');
  if(entryPath.toLowerCase().endsWith('.gltf')){
    return inspect(new TextDecoder('utf-8',{fatal:true}).decode(bytes),entryPath,'gltf');
  }
  if(bytes.length<20)throw new Error('STUDIO_GLTF_INVALID');
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(data.getUint32(0,true)!==0x46546c67 || data.getUint32(4,true)!==2 || data.getUint32(8,true)!==bytes.length)throw new Error('STUDIO_GLTF_INVALID');
  const chunkLength=data.getUint32(12,true),chunkType=data.getUint32(16,true);
  if(chunkType!==0x4e4f534a || chunkLength>bytes.length-20 || chunkLength%4!==0)throw new Error('STUDIO_GLTF_INVALID');
  if(bytes.length>20+chunkLength){
    const offset=20+chunkLength;
    if(bytes.length<offset+8 || data.getUint32(offset+4,true)!==0x004e4942 || data.getUint32(offset,true)!==bytes.length-offset-8)throw new Error('STUDIO_GLTF_INVALID');
  }
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+chunkLength)).replace(/\u0000+$/g,'').trimEnd();
  return inspect(text,entryPath,'glb');
}

/** Resolve dot segments inside a bundle, never outside it. URL loading is still GLTFLoader's job. */
export function resolveStudioReference(entry: string, uri: string): string {
  if (!uri || uri.startsWith('/') || uri.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(uri)) throw new Error('STUDIO_PATH_REJECTED');
  const root = 'https://studio.invalid/bundle/';
  const base = root + safeStudioPath(entry).split('/').map(encodeURIComponent).join('/');
  const url = new URL(uri, base);
  if (url.origin !== 'https://studio.invalid' || !url.pathname.startsWith('/bundle/') || url.search || url.hash) throw new Error('STUDIO_PATH_REJECTED');
  return safeStudioPath(url.pathname.slice('/bundle/'.length));
}
