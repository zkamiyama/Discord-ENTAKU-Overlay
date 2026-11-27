import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {SceneEffectsIndex,visibleCasterKey} from '../../src/web/studio/scene-effects-index.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
test('shadow and reflection selection uses source generation, not camera frames',()=>{
 const index=new SceneEffectsIndex(),scene=new THREE.Scene(),renderer={shadowMap:{}} as THREE.WebGLRenderer;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({roughness:.2}));scene.add(mesh,new THREE.DirectionalLight());
 expect(index.update(renderer,scene,DEFAULT_QUALITY,'1',1)).toBe(true);const receivers=index.reflective;
 expect(index.update(renderer,scene,DEFAULT_QUALITY,'1',1)).toBe(false);expect(index.reflective).toBe(receivers);expect(index.lights[0]!.shadow.autoUpdate).toBe(false);
 mesh.visible=false;expect(index.update(renderer,scene,DEFAULT_QUALITY,'2',1)).toBe(true);expect(index.reflective).toEqual([]);
 index.invalidate();expect(index.update(renderer,scene,DEFAULT_QUALITY,'2',1)).toBe(true);mesh.geometry.dispose();mesh.material.dispose();
});

test('departed reserved props and returning props invalidate shadows without seat edits',()=>{
 const index=new SceneEffectsIndex(),scene=new THREE.Scene(),renderer={shadowMap:{}} as THREE.WebGLRenderer;
 const plate=new THREE.Group(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({roughness:.2}));plate.add(mesh);scene.add(plate);
 const key=()=>visibleCasterKey([plate]);
 expect(index.update(renderer,scene,DEFAULT_QUALITY,key(),1)).toBe(true);expect(index.reflective).toEqual([mesh]);
 expect(index.update(renderer,scene,DEFAULT_QUALITY,key(),1)).toBe(false);
 plate.visible=false;expect(index.update(renderer,scene,DEFAULT_QUALITY,key(),1)).toBe(true);expect(index.reflective).toEqual([]);
 plate.visible=true;expect(index.update(renderer,scene,DEFAULT_QUALITY,key(),1)).toBe(true);expect(index.reflective).toEqual([mesh]);
 mesh.geometry.dispose();mesh.material.dispose();
});

test('disabled shadow targets are disposed and a re-enabled light can allocate again',()=>{
 const index=new SceneEffectsIndex(),scene=new THREE.Scene(),renderer={shadowMap:{}} as THREE.WebGLRenderer;
 const light=new THREE.DirectionalLight();scene.add(light);
 index.update(renderer,scene,DEFAULT_QUALITY,'one',1);
 const map=new THREE.WebGLRenderTarget(32,32);let disposed=0;map.addEventListener('dispose',()=>disposed++);
 light.shadow.map=map;
 index.update(renderer,scene,{...DEFAULT_QUALITY,shadows:'off'},'one',1);
 expect(disposed).toBe(1);expect(light.shadow.map).toBeNull();expect(light.castShadow).toBe(false);
 index.update(renderer,scene,DEFAULT_QUALITY,'one',1);
 expect(light.castShadow).toBe(true);expect(light.shadow.needsUpdate).toBe(true);
 light.dispose();
});
