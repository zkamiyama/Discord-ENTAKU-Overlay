import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { StudioBundle } from '../../studio/store.ts';
import type { StudioClient } from '../shared/client.ts';
/** Release shared materials/textures once, including ImageBitmaps not owned by the GC. */
export function disposeObject(root:THREE.Object3D):void {
  const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),images=new Set<ImageBitmap>();
  root.traverse(o=>{
    if(o instanceof THREE.Mesh){geometry.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material])materials.add(material);}
  });
  for(const material of materials){
    for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
    if(material instanceof THREE.ShaderMaterial)for(const u of Object.values(material.uniforms))if(u.value instanceof THREE.Texture)textures.add(u.value);
  }
  for(const texture of textures){if(typeof ImageBitmap!=='undefined'&&texture.image instanceof ImageBitmap)images.add(texture.image);texture.dispose();}
  for(const image of images)image.close();for(const g of geometry)g.dispose();for(const m of materials)m.dispose();root.removeFromParent();
}
export async function loadStudioBundle(client:StudioClient,renderer:THREE.WebGLRenderer,id:string):Promise<THREE.Group>{
  const bundle:StudioBundle=await (await client.authorizedFetch('/api/studio/bundles/'+id)).json();
  const manager=new THREE.LoadingManager(),urls=new Map<string,string>();
  const root=new URL(`/__studio/${id}/`,location.origin).href;
  let failed=false;
  manager.onError=()=>{failed=true;};
  const draco=new DRACOLoader().setDecoderPath('/static/decoders/draco/').setWorkerLimit(2);
  const ktx=new KTX2Loader().setTranscoderPath('/static/decoders/basis/').setWorkerLimit(2).detectSupport(renderer);
  let model:THREE.Group|undefined;
  try {
    // Bounded parallel fetch. No remote URLs are fetched on behalf of imported documents.
    let index=0;
    const transfers=await Promise.allSettled(Array.from({length:Math.min(4,bundle.files.length)},async()=>{
      while(index<bundle.files.length){
        const file=bundle.files[index++]!;
        const response=await client.authorizedFetch(`/api/studio/bundles/${id}/file?path=${encodeURIComponent(file.path)}`);
        urls.set(file.path,URL.createObjectURL(await response.blob()));
      }
    }));
    const failure=transfers.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    manager.setURLModifier(url=>{
      if(url.startsWith('data:')||url.startsWith('blob:'))return url; // GLTFLoader creates blobs for GLB-embedded images.
      const normalized=new URL(url,root);
      if(!normalized.href.startsWith(root)||normalized.search||normalized.hash)throw new Error('STUDIO_RESOURCE_REJECTED');
      const path=decodeURIComponent(normalized.pathname.slice(new URL(root).pathname.length));
      const mapped=urls.get(path);if(!mapped)throw new Error('STUDIO_DEPENDENCY_MISSING');return mapped;
    });
    const loader=new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
    const path=bundle.entry.split('/').map(encodeURIComponent).join('/');
    const gltf=await loader.loadAsync(root+path);model=gltf.scene;
    if(failed)throw new Error('STUDIO_TEXTURE_LOAD_FAILED');
    let meshes=0,triangles=0;
    model.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position')?.count??0)/3*(o instanceof THREE.InstancedMesh?o.count:1);}});
    if(meshes>5000||triangles>5_000_000)throw new Error('STUDIO_GEOMETRY_LIMIT');
    model.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(model);
    if(!box.isEmpty()&&![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))throw new Error('STUDIO_GEOMETRY_INVALID');
    return model;
  }catch(e){if(model)disposeObject(model);throw e;}
  finally {for(const url of urls.values())URL.revokeObjectURL(url);draco.dispose();ktx.dispose();}
}
