import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {StudioModelRegistry} from '../../src/web/studio/model-registry.ts';
test('instance materials are isolated but geometry and textures remain owned by the shared source',async()=>{
 const source=new THREE.Group(),geometry=new THREE.BoxGeometry(),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture});
 source.add(new THREE.Mesh(geometry,material));let geometryDisposed=0,textureDisposed=0,loads=0;
 geometry.addEventListener('dispose',()=>geometryDisposed++);texture.addEventListener('dispose',()=>textureDisposed++);
 const registry=new StudioModelRegistry(async()=>{loads++;return source;});
 const signal=new AbortController().signal;
 const [a,b]=await Promise.all([registry.instantiate('same',signal),registry.instantiate('same',signal)]);
 const left=a.root.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
 const right=b.root.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
 expect(loads).toBe(1);expect(left.geometry).toBe(right.geometry);expect(left.material.map).toBe(texture);expect(left.material).not.toBe(right.material);
 left.material.opacity=.2;expect(right.material.opacity).toBe(1);
 let disposed=0;left.material.addEventListener('dispose',()=>disposed++);
 a.dispose();a.dispose();expect(disposed).toBe(1);expect(geometryDisposed).toBe(0);expect(textureDisposed).toBe(0);
 b.dispose();expect(geometryDisposed).toBe(1);expect(textureDisposed).toBe(1);expect(registry.size).toBe(0);
 registry.dispose();
});
test('cancelled candidate releases only its lease while another consumer still loads',async()=>{
 let resolve!:(value:THREE.Group)=>void,aborted=false;
 const registry=new StudioModelRegistry(async(_id,signal)=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(r=>{resolve=r;});});
 const cancel=new AbortController(),other=new AbortController();
 const a=registry.instantiate('same',cancel.signal),b=registry.instantiate('same',other.signal);
 const failed=expect(a).rejects.toBeDefined();
 await Promise.resolve();cancel.abort();await failed;expect(aborted).toBe(false);
 resolve(new THREE.Group());const instance=await b;expect(registry.size).toBe(1);
 instance.dispose();expect(aborted).toBe(true);expect(registry.size).toBe(0);registry.dispose();
});
