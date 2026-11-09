import {inspectGltfEntry} from '../../studio/gltf.ts';
import {prepareStudioMaterials} from './studio-materials.ts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { StudioBundle } from '../../studio/store.ts';
import type { StudioClient } from '../shared/client.ts';
import { disposeObject } from './dispose.ts';
export { disposeObject } from './dispose.ts';
export async function loadStudioBundle(client:StudioClient,renderer:THREE.WebGLRenderer|undefined,id:string):Promise<THREE.Group>{
  const bundle:StudioBundle=await (await client.localFetch('/api/studio/bundles/'+id)).json();
  const manager=new THREE.LoadingManager(),urls=new Map<string,string>();
  const root=new URL(`/__studio/${id}/`,location.origin).href;
  let failed=false;
  manager.onError=()=>{failed=true;};
  const draco=new DRACOLoader().setDecoderPath('/static/decoders/draco/').setWorkerLimit(2);
  const ktx=renderer?new KTX2Loader().setTranscoderPath('/static/decoders/basis/').setWorkerLimit(2).detectSupport(renderer):undefined;
  let needsGpu=false;
  let model:THREE.Group|undefined;
  try {
    // Bounded parallel fetch. No remote URLs are fetched on behalf of imported documents.
    let index=0;
    const transfers=await Promise.allSettled(Array.from({length:Math.min(4,bundle.files.length)},async()=>{
      while(index<bundle.files.length){
        const file=bundle.files[index++]!;
        const response=await client.localFetch(`/api/studio/bundles/${id}/file?path=${encodeURIComponent(file.path)}`);
        const blob=await response.blob();
        if(!renderer&&file.path===bundle.entry){
          const document=inspectGltfEntry(new Uint8Array(await blob.arrayBuffer()),bundle.entry).json;
          needsGpu=[...(Array.isArray(document.extensionsUsed)?document.extensionsUsed:[]),...(Array.isArray(document.extensionsRequired)?document.extensionsRequired:[])].includes('KHR_texture_basisu');
        }
        urls.set(file.path,URL.createObjectURL(blob));
      }
    }));
    const failure=transfers.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    if(needsGpu)throw new Error('STUDIO_GPU_VALIDATION_REQUIRED');
    manager.setURLModifier(url=>{
      if(url.startsWith('data:')||url.startsWith('blob:'))return url; // GLTFLoader creates blobs for GLB-embedded images.
      const normalized=new URL(url,root);
      if(!normalized.href.startsWith(root)||normalized.search||normalized.hash)throw new Error('STUDIO_RESOURCE_REJECTED');
      const path=decodeURIComponent(normalized.pathname.slice(new URL(root).pathname.length));
      const mapped=urls.get(path);if(!mapped)throw new Error('STUDIO_DEPENDENCY_MISSING');return mapped;
    });
    const loader=new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    if(ktx)loader.setKTX2Loader(ktx);
    const path=bundle.entry.split('/').map(encodeURIComponent).join('/');
    const gltf=await loader.loadAsync(root+path);model=gltf.scene;
    if(failed)throw new Error('STUDIO_TEXTURE_LOAD_FAILED');
    let meshes=0,triangles=0;
    model.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position')?.count??0)/3*(o instanceof THREE.InstancedMesh?o.count:1);}});
    if(meshes>5000||triangles>5_000_000)throw new Error('STUDIO_GEOMETRY_LIMIT');
    prepareStudioMaterials(model);
    model.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(model);
    if(!box.isEmpty()&&![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))throw new Error('STUDIO_GEOMETRY_INVALID');
    return model;
  }catch(e){if(model)disposeObject(model);throw e;}
  finally {for(const url of urls.values())URL.revokeObjectURL(url);draco.dispose();ktx?.dispose();}
}
