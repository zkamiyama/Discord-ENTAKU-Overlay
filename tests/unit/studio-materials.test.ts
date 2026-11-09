import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {prepareStudioMaterials,installStudioAlphaShadows,STUDIO_UNLIT_LAYER} from '../../src/web/studio/studio-materials.ts';
import {disposeObject} from '../../src/web/studio/dispose.ts';
function before(mesh:THREE.Mesh,material:THREE.Material){(mesh.onBeforeShadow as Function)(null,mesh,null,null,mesh.geometry,material,null);}
test('unlit studio art has its own layer; PBR and smooth beauty alpha stay unchanged',()=>{
 const root=new THREE.Group(),map=new THREE.Texture();
 const basic=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false}),pbr=new THREE.MeshStandardMaterial({map});
 const logo=new THREE.Mesh(new THREE.PlaneGeometry(),basic),wall=new THREE.Mesh(new THREE.PlaneGeometry(),pbr);root.add(logo,wall);prepareStudioMaterials(root);
 expect(logo.layers.isEnabled(STUDIO_UNLIT_LAYER)).toBe(true);expect(logo.layers.isEnabled(1)).toBe(false);
 expect(wall.layers.mask).toBe(1);expect(basic.alphaTest).toBe(0);expect(basic.transparent).toBe(true);expect(basic.depthWrite).toBe(false);expect(basic.toneMapped).toBe(false);
 expect(logo.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);expect(wall.customDepthMaterial).toBeUndefined();disposeObject(root);
});
test('BLEND shadow materials are private, support distance/depth, and do not alter MASK',()=>{
 const map=new THREE.Texture(),m=new THREE.MeshStandardMaterial({map,transparent:true,opacity:.8});
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),m);installStudioAlphaShadows(mesh);const depth=mesh.customDepthMaterial!;
 before(mesh,depth);expect(depth.alphaTest).toBe(.5);expect(depth.opacity).toBe(.8);
 before(mesh,mesh.customDistanceMaterial!);expect(mesh.customDistanceMaterial!.alphaTest).toBe(.5);
 installStudioAlphaShadows(mesh);expect(mesh.customDepthMaterial).toBe(depth);
 const masked=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({map,alphaTest:.3}));installStudioAlphaShadows(masked);expect(masked.customDepthMaterial).toBeUndefined();
 let released=0;depth.addEventListener('dispose',()=>released++);mesh.customDistanceMaterial!.addEventListener('dispose',()=>released++);disposeObject(mesh);expect(released).toBe(2);disposeObject(masked);
});
test('existing custom shadow materials are not overwritten',()=>{
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({map:new THREE.Texture(),transparent:true}));
 const existing=new THREE.MeshDepthMaterial();mesh.customDepthMaterial=existing;const callback=mesh.onBeforeShadow;installStudioAlphaShadows(mesh);expect(mesh.customDepthMaterial).toBe(existing);expect(mesh.onBeforeShadow).toBe(callback);disposeObject(mesh);
});
