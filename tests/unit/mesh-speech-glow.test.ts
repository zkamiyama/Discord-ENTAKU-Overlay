import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {MeshSpeechGlow} from '../../src/web/studio/mesh-speech.ts';
import {projectedObjectHeightPixels,speechScreenGlowRadius} from '../../src/web/gaussian/speech-screen.ts';

function model(){
 const group=new THREE.Group(),geometry=new THREE.BoxGeometry(.7,1.7,.3);
 const material=new THREE.MeshStandardMaterial({color:0x5566aa,roughness:.7});
 group.add(new THREE.Mesh(geometry,material));
 return {group,geometry,material};
}
test('mesh speech clones borrow geometry, stay in display layer, and restore source material after fading',()=>{
 const {group,geometry,material}=model();
 const glow=new MeshSpeechGlow(group,'12345');
 expect(glow.hullCount).toBe(2);
 const body=group.children[0] as THREE.Mesh;
 const shells=body.children.filter(o=>o instanceof THREE.Mesh) as THREE.Mesh[];
 expect(shells).toHaveLength(2);
 for(const shell of shells){
  expect(shell.geometry).toBe(geometry);
  expect(shell.layers.isEnabled(1)).toBe(true);
  expect(shell.layers.isEnabled(0)).toBe(false);
  expect(shell.userData.entakuMeshSpeechOutline).toBe(true);
  expect(shell.castShadow).toBe(false);
  expect(shell.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  expect((shell.material as THREE.Material).depthWrite).toBe(false);
 }
 glow.setSpeech(.8,4);glow.setPresence(.45);
 expect(glow.active).toBe(true);expect(shells.every(o=>o.visible)).toBe(true);
 expect(material.opacity).toBeCloseTo(.45);expect(material.transparent).toBe(true);
 expect(material.depthWrite).toBe(false);
 glow.setSpeech(0);glow.setPresence(1);
 expect(shells.every(o=>!o.visible)).toBe(true);
 expect(material.opacity).toBe(1);expect(material.transparent).toBe(false);expect(material.depthWrite).toBe(true);
 let geometryDisposed=0;geometry.addEventListener('dispose',()=>geometryDisposed++);
 glow.dispose();glow.dispose();
 expect(body.children).toHaveLength(0);
 expect(geometryDisposed).toBe(0);
 expect(material.opacity).toBe(1);expect(material.transparent).toBe(false);
 geometry.dispose();material.dispose();
});
test('mesh silhouette width shares the same projected-body radius law as Gaussian',()=>{
 const {group,geometry,material}=model();
 const glow=new MeshSpeechGlow(group,'100');const camera=new THREE.PerspectiveCamera(40,1,.1,100);
 camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 group.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(group,true).applyMatrix4(group.matrixWorld.clone().invert());
 const near=projectedObjectHeightPixels(group,bounds,camera,720)!;
 expect(near).toBeGreaterThan(250);
 const a=speechScreenGlowRadius(near,720,4);
 camera.position.z=10;camera.updateMatrixWorld(true);
 const far=projectedObjectHeightPixels(group,bounds,camera,720)!;
 expect(far).toBeLessThan(near*.52);
 expect(speechScreenGlowRadius(far,720,4)).toBeLessThan(a*.7);
 expect(speechScreenGlowRadius(far,720,2)).toBeCloseTo(speechScreenGlowRadius(far,720,4)*.5);
 glow.dispose();geometry.dispose();material.dispose();
});
test('skin and instanced meshes retain animation inputs and never own source GPU arrays',()=>{
 const group=new THREE.Group(),geometry=new THREE.BoxGeometry(.4,.8,.2),material=new THREE.MeshBasicMaterial();
 const skinIndex=new Uint16Array(geometry.getAttribute('position')!.count*4),skinWeight=new Float32Array(skinIndex.length);
 for(let i=0;i<skinWeight.length;i+=4)skinWeight[i]=1;
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeight,4));
 const bone=new THREE.Bone(),skin=new THREE.SkinnedMesh(geometry,material);skin.add(bone);skin.bind(new THREE.Skeleton([bone]));group.add(skin);
 const instance=new THREE.InstancedMesh(geometry,material,2);instance.position.x=1;group.add(instance);
 const glow=new MeshSpeechGlow(group,'100');expect(glow.hullCount).toBe(4);
 const skinShells=skin.children.filter(o=>o instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh[];
 expect(skinShells).toHaveLength(2);
 expect(skinShells[0]!.skeleton).toBe(skin.skeleton);
 const instancedShells=instance.children.filter(o=>o instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
 expect(instancedShells).toHaveLength(2);
 expect(instancedShells[0]!.instanceMatrix).toBe(instance.instanceMatrix);
 glow.dispose();skin.skeleton.dispose();geometry.dispose();material.dispose();
});
test('invalid model assignment or empty geometry cannot create an outline',()=>{
 const {group,geometry,material}=model();
 expect(()=>new MeshSpeechGlow(group,'not-a-user')).toThrow('MESH_SPEAKER_ID_INVALID');
 const empty=new THREE.Group();expect(()=>new MeshSpeechGlow(empty,'100')).toThrow('MESH_SPEECH_BOUNDS_INVALID');
 geometry.dispose();material.dispose();
});

test('normal-less GLTF geometry remains byte-for-byte untouched and halo clone is freed',()=>{
 const group=new THREE.Group(),source=new THREE.BoxGeometry(.5,.5,.5);
 source.deleteAttribute('normal');const material=new THREE.MeshStandardMaterial();const mesh=new THREE.Mesh(source,material);
 group.add(mesh);
 let originalDisposed=0,cloneDisposed=0;source.addEventListener('dispose',()=>originalDisposed++);
 const glow=new MeshSpeechGlow(group,'100');
 const outlines=mesh.children.filter(o=>o instanceof THREE.Mesh) as THREE.Mesh[];
 expect(outlines).toHaveLength(2);
 expect(source.getAttribute('normal')).toBeUndefined();
 expect(outlines[0]!.geometry).not.toBe(source);
 expect(outlines[0]!.geometry).toBe(outlines[1]!.geometry);
 expect(outlines[0]!.geometry.getAttribute('normal')).toBeDefined();
 outlines[0]!.geometry.addEventListener('dispose',()=>cloneDisposed++);
 glow.dispose();expect(cloneDisposed).toBe(1);expect(originalDisposed).toBe(0);
 expect(source.getAttribute('normal')).toBeUndefined();
 source.dispose();material.dispose();
});
