import { expect, test } from 'bun:test';
import { DEFAULT_STUDIO_SCENE, safeStudioPath, studioAssetUrlAllowed, validateStudioScene } from '../../src/studio/manifest.ts';
import { inspectGltfEntry } from '../../src/studio/gltf.ts';
const enc=new TextEncoder();
const bytes=(text:string)=>enc.encode(text);
const scene=()=>structuredClone(DEFAULT_STUDIO_SCENE);
function glb(json:Record<string,unknown>):Uint8Array{
  const payload=bytes(JSON.stringify(json)),pad=(4-payload.length%4)%4;
  const out=new Uint8Array(20+payload.length+pad);const dv=new DataView(out.buffer);
  dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true);
  dv.setUint32(12,payload.length+pad,true);dv.setUint32(16,0x4e4f534a,true);
  out.set(payload,20);out.fill(32,20+payload.length);return out;
}
test('studio validates primitive and model scene with strict safe bounds',()=>{
 const value=scene();
 value.objects=[
  {id:'desk',kind:'box',color:'#aAcCff',size:[1,2,3],transform:{position:[1,0,0],yawDeg:45,scale:[1,1,1]}},
  {id:'stage',kind:'model',bundleId:'a'.repeat(64),transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}},
  {id:'floor',kind:'plane',size:[20,20],color:'#334455',transform:{position:[0,-.2,0],yawDeg:0,scale:[1,1,1]}},
  {id:'lamp',kind:'point-light',position:[0,3,0],color:'#ffccaa',intensity:4},
 ];
 expect(validateStudioScene(value).objects).toHaveLength(4);
 expect(validateStudioScene(value).objects[0]).toMatchObject({color:'#aaccff'});
 expect(validateStudioScene(scene())).toEqual(DEFAULT_STUDIO_SCENE);
});
test('studio rejects unknown keys, duplicate identifiers, zero scales and unsupported schemas',()=>{
 const v=scene();v.schemaVersion=2 as 1;expect(()=>validateStudioScene(v)).toThrow('STUDIO_SCHEMA_UNSUPPORTED');
 const bad=scene();(bad as any).extra='x';expect(()=>validateStudioScene(bad)).toThrow('STUDIO_SCENE_INVALID');
 const duplicate=scene();duplicate.objects=[
  {id:'a',kind:'point-light',position:[0,1,0],color:'#ffffff',intensity:1},
  {id:'a',kind:'point-light',position:[0,1,0],color:'#ffffff',intensity:1},
 ];expect(()=>validateStudioScene(duplicate)).toThrow('STUDIO_SCENE_INVALID');
 const scale=scene();scale.objects=[{id:'a',kind:'model',bundleId:'a'.repeat(64),transform:{position:[0,0,0],yawDeg:0,scale:[1,0,1]}}];
 expect(()=>validateStudioScene(scale)).toThrow('STUDIO_SCENE_INVALID');
});
test('relative texture references are supported without allowing path escapes or network URLs',()=>{
 for(const ok of ['textures/wood.png','textures/Wood%20Grain.png','shader.bin'])expect(safeStudioPath(ok)).toBeTruthy();
 for(const bad of ['../etc/passwd','./model.bin','/absolute/file','https://host/wood.png','C:/models/a.glb','a\\b','a/%2e%2e/b','a/%2f/b','file://localhost/x']){
  expect(()=>safeStudioPath(bad)).toThrow('STUDIO_PATH_REJECTED');
 }
 expect(studioAssetUrlAllowed('data:image/png;base64,aGVsbG8=')).toBe(true);
 expect(studioAssetUrlAllowed('data:text/html;base64,SGVsbG8=')).toBe(false);
});
test('GLTF inspector resolves relative resources and rejects unsolicited HTTPS',()=>{
 const input={asset:{version:'2.0'},buffers:[{uri:'textures/m.glb'}],images:[{uri:'textures/Wood%20Grain.png'}]};
 const parsed=inspectGltfEntry(bytes(JSON.stringify(input)),'studio/main.gltf');
 expect(parsed.externalPaths).toEqual(['studio/textures/Wood Grain.png','studio/textures/m.glb']);
 expect(inspectGltfEntry(glb({asset:{version:'2.0'},meshes:[]}), 'studio.glb').source).toBe('glb');
 expect(()=>inspectGltfEntry(bytes(JSON.stringify({...input,images:[{uri:'https://example.com/img.png'}]})),'main.gltf')).toThrow('STUDIO_PATH_REJECTED');
 expect(()=>inspectGltfEntry(glb({asset:{version:'1.0'}}),'main.glb')).toThrow('STUDIO_GLTF_VERSION_UNSUPPORTED');
});
