import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';
import { StudioStore, unpackStudioZip } from '../../src/studio/store.ts';
import { DEFAULT_STUDIO_SCENE } from '../../src/studio/manifest.ts';
import { resolveStudioReference } from '../../src/studio/gltf.ts';
const json=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const files=()=>[
 {path:'models/room.gltf',bytes:json({asset:{version:'2.0'},buffers:[{uri:'../shared/mesh.bin',byteLength:12}]})},
 {path:'shared/mesh.bin',bytes:new Uint8Array(12)},
];
test('bundles collect relative dependencies and survive disk restart without using asset paths as filesystem paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-studio-'));
 try{
  const store=new StudioStore(dir);await store.initialize();
  const bundle=await store.importFiles(files());
  expect(bundle.files).toHaveLength(2);
  expect((await store.importFiles(files())).bundleId).toBe(bundle.bundleId);
  const scene=structuredClone(DEFAULT_STUDIO_SCENE);
  scene.objects.push({id:'room',kind:'model',bundleId:bundle.bundleId,transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}});
  const saved=await store.save(scene);expect(saved.revision).toBe(1);
  const restored=new StudioStore(dir);expect(await restored.initialize()).toEqual(saved);
  expect(await restored.list()).toHaveLength(1);
  expect((await restored.file(bundle.bundleId,'shared/mesh.bin')).bytes).toEqual(new Uint8Array(12));
  await expect(restored.file(bundle.bundleId,'../scene.json')).rejects.toThrow('STUDIO_FILE_NOT_FOUND');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('ZIP import uses bounded inflate and rejects missing resources, duplicates and escaping paths',async()=>{
 const store=new StudioStore();
 const zipped=zipSync(Object.fromEntries(files().map(f=>[f.path,f.bytes])));
 expect((await store.importFiles(unpackStudioZip(zipped))).files).toHaveLength(2);
 await expect(store.importFiles(files().slice(0,1))).rejects.toThrow('STUDIO_DEPENDENCY_MISSING');
 await expect(store.importFiles([files()[0]!,files()[0]!])).rejects.toThrow('STUDIO_DUPLICATE_PATH');
 expect(()=>unpackStudioZip(zipSync({'../escape.bin':new Uint8Array(4)}))).toThrow('STUDIO_PATH_REJECTED');
 expect(()=>resolveStudioReference('models/room.gltf','../../escape.bin')).toThrow('STUDIO_PATH_REJECTED');
 expect(resolveStudioReference('models/room.gltf','../shared/mesh.bin')).toBe('shared/mesh.bin');
 expect(resolveStudioReference('room.gltf','./a%20b.png')).toBe('a b.png');
});
