import {test,expect} from 'bun:test';
import * as THREE from 'three';
import type {SplatMesh} from '@sparkjsdev/spark';
import {setGaussianSpeechBounds,clearGaussianSpeechGlow} from '../../src/web/gaussian/speech-glow.ts';
import {projectedGaussianHeightPixels,gaussianScreenGlowRadius} from '../../src/web/gaussian/speech-screen.ts';

function setup(){
 const mesh=new THREE.Object3D() as SplatMesh;
 const camera=new THREE.PerspectiveCamera(45,1,.1,100);
 camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 setGaussianSpeechBounds(mesh,new THREE.Box3(new THREE.Vector3(-.3,-1,-.12),new THREE.Vector3(.3,1,.12)));
 mesh.updateMatrixWorld(true);
 return {mesh,camera};
}

test('screen-space radius follows projected avatar height, camera distance and render resolution',()=>{
 const {mesh,camera}=setup();
 const closeHeight=projectedGaussianHeightPixels(mesh,camera,1080)!;
 const close=gaussianScreenGlowRadius(mesh,camera,1080,4);
 expect(closeHeight).toBeGreaterThan(480);
 expect(close).toBeGreaterThan(29);
 expect(close).toBeLessThan(40);
 camera.position.z=10;camera.updateMatrixWorld(true);
 const farHeight=projectedGaussianHeightPixels(mesh,camera,1080)!;
 const far=gaussianScreenGlowRadius(mesh,camera,1080,4);
 expect(farHeight).toBeLessThan(closeHeight*.55);
 expect(far).toBeLessThan(close*.6);
 expect(far).toBeGreaterThan(10);
 expect(gaussianScreenGlowRadius(mesh,camera,1080,8)).toBeCloseTo(far*2,5);
 expect(gaussianScreenGlowRadius(mesh,camera,1080,1)).toBeCloseTo(far*.25,5);
 expect(gaussianScreenGlowRadius(mesh,camera,540,4)).toBeCloseTo(far*.5,5);
 clearGaussianSpeechGlow(mesh);
 expect(projectedGaussianHeightPixels(mesh,camera,1080)).toBeNull();
});

test('each participant uses its own box and world transform, without scanning Gaussian arrays',()=>{
 const {mesh,camera}=setup();
 const a=gaussianScreenGlowRadius(mesh,camera,1080,4);
 mesh.scale.y=.5;mesh.updateMatrixWorld(true);
 const smaller=gaussianScreenGlowRadius(mesh,camera,1080,4);
 expect(smaller).toBeLessThan(a*.7);
 mesh.scale.y=1;
 mesh.position.z=3;mesh.updateMatrixWorld(true);
 expect(gaussianScreenGlowRadius(mesh,camera,1080,4)).toBeGreaterThan(a);
 const tiny=new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(.05,.05,.05));
 setGaussianSpeechBounds(mesh,tiny);
 expect(gaussianScreenGlowRadius(mesh,camera,1080,4)).toBeCloseTo(1080*.012,4);
 expect(()=>setGaussianSpeechBounds(mesh,new THREE.Box3().makeEmpty())).toThrow('GAUSSIAN_SPEECH_BOUNDS_INVALID');
 clearGaussianSpeechGlow(mesh);
});

test('fallback remains bounded for uncalibrated sources, tiny targets and invalid settings',()=>{
 const mesh=new THREE.Object3D() as SplatMesh, camera=new THREE.PerspectiveCamera();
 expect(gaussianScreenGlowRadius(mesh,undefined,undefined,4)).toBe(8.5);
 expect(gaussianScreenGlowRadius(mesh,camera,480,4)).toBeCloseTo(11.52,6);
 expect(gaussianScreenGlowRadius(mesh,camera,1080,4)).toBeGreaterThan(gaussianScreenGlowRadius(mesh,camera,480,4));
 expect(gaussianScreenGlowRadius(mesh,camera,1080,NaN)).toBeGreaterThan(0);
 expect(gaussianScreenGlowRadius(mesh,camera,1080,8)).toBeCloseTo(gaussianScreenGlowRadius(mesh,camera,1080,4)*2);
});
