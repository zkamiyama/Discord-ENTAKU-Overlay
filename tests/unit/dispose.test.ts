import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {disposeObject} from '../../src/web/studio/dispose.ts';
test('scene disposal includes lines, points and shared resources exactly once',()=>{
  const root=new THREE.Group(),parent=new THREE.Group();parent.add(root);
  const geometry=new THREE.BufferGeometry(),texture=new THREE.Texture();
  const material=new THREE.MeshBasicMaterial({map:texture});
  root.add(new THREE.Mesh(geometry,material),new THREE.Line(geometry,material),new THREE.Points(geometry,material));
  let g=0,m=0,t=0;geometry.addEventListener('dispose',()=>g++);material.addEventListener('dispose',()=>m++);texture.addEventListener('dispose',()=>t++);
  disposeObject(root);disposeObject(root);
  expect([g,m,t]).toEqual([1,1,1]);expect(parent.children).toHaveLength(0);expect(root.children).toHaveLength(0);
});
test('scene disposal invokes instancing and skeleton hooks and releases shader texture arrays',()=>{
  const root=new THREE.Group(),g=new THREE.BufferGeometry(),texture=new THREE.Texture();
  const m=new THREE.ShaderMaterial({uniforms:{maps:{value:[texture,texture]}}});
  const instance=new THREE.InstancedMesh(g,m,2),skeleton=new THREE.Skeleton([]);
  const skin=new THREE.SkinnedMesh(g,m);skin.bind(skeleton);root.add(instance,skin);
  skeleton.computeBoneTexture();let i=0,b=0,t=0;
  instance.addEventListener('dispose',()=>i++);skeleton.boneTexture!.addEventListener('dispose',()=>b++);texture.addEventListener('dispose',()=>t++);
  disposeObject(root);expect([i,b,t]).toEqual([1,1,1]);expect(skeleton.boneTexture).toBeNull();
});
