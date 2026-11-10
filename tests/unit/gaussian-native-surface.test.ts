import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {PackedSplats,SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
import {GaussianSurface,nativeSurfaceVertex,renderGaussianSurfaces,GAUSSIAN_SURFACE_LAYER,nativeSurfaceDiagnostics} from '../../src/web/gaussian/surface.ts';
import {gaussianShadowKey} from '../../src/web/studio/gaussian-layers.ts';
import {SceneEffectsIndex} from '../../src/web/studio/scene-effects-index.ts';
import {DEFAULT_QUALITY,validateQuality} from '../../src/studio/quality.ts';
import {GaussianAvatarVisual} from '../../src/web/gaussian/avatar-visual.ts';
import type {GaussianRuntime} from '../../src/web/gaussian/runtime.ts';
import {gaussianFixture} from '../helpers/gaussian.ts';

async function packed(){const value=new PackedSplats({numSplats:2,packedArray:new Uint32Array(8192)});await value.initialized;return value;}
function renderer(draw=()=>{}){
 let target:THREE.WebGLRenderTarget|null=null;
 return {getContext:()=>({getExtension:()=>null}),autoClear:true,outputColorSpace:THREE.SRGBColorSpace,shadowMap:{autoUpdate:true},
 getRenderTarget:()=>target,setRenderTarget:(value:THREE.WebGLRenderTarget|null)=>{target=value;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
 getViewport:(v:THREE.Vector4)=>v.set(0,0,100,100),getScissor:(v:THREE.Vector4)=>v.set(0,0,100,100),getScissorTest:()=>false,
 getClearColor:(v:THREE.Color)=>v.set(0),getClearAlpha:()=>0,setClearColor:()=>{},setClearAlpha:()=>{},setViewport:()=>{},setScissor:()=>{},setScissorTest:()=>{},render:draw} as unknown as THREE.WebGLRenderer;
}
test('native alpha threshold migrates old quality settings and rejects non-finite or unsafe values',async()=>{
 expect(validateQuality({shadows:'off'}).gaussianAlphaClip).toBe(.3);
 for(const value of [NaN,Infinity,-1,0,1,'0.3'])expect(()=>validateQuality({gaussianAlphaClip:value})).toThrow();
 for(const value of [.01,.3,.99])expect(validateQuality({gaussianAlphaClip:value}).gaussianAlphaClip).toBe(value);
});
test('native instances borrow one four-vertex geometry and packed source, never dispose borrowed textures',async()=>{
 const data=await packed(),a=new GaussianSurface(data),b=new GaussianSurface(data);let geometry=0,source=0;
 a.geometry.addEventListener('dispose',()=>geometry++);const old=data.dispose.bind(data);data.dispose=()=>{source++;old();};
 expect(a.geometry).toBe(b.geometry);expect(a.geometry.instanceCount).toBe(2);expect(a.geometry.getAttribute('position').count).toBe(4);
 expect(a.layers.isEnabled(0)).toBe(false);expect(a.layers.isEnabled(1)).toBe(false);expect(a.layers.isEnabled(GAUSSIAN_SURFACE_LAYER)).toBe(true);
 expect(a.material.colorWrite).toBe(false);expect(a.material.blending).toBe(THREE.NoBlending);expect(a.customDepthMaterial).toBe(a.material);
 a.dispose();a.dispose();expect(geometry).toBe(0);expect(source).toBe(0);b.dispose();expect(geometry).toBe(1);expect(source).toBe(0);
 const c=new GaussianSurface(data);expect(c.geometry).not.toBe(a.geometry);c.dispose();data.dispose();
});
test('native shadow revision follows transform and visibility, not camera or speaking color',async()=>{
 const data=await packed(),native=new GaussianSurface(data),scene=new THREE.Scene(),group=new THREE.Group(),light=new THREE.DirectionalLight(),camera=new THREE.PerspectiveCamera();group.add(native);scene.add(group,light,camera);
 const r=renderer(),index=new SceneEffectsIndex();index.update(r,scene,DEFAULT_QUALITY,'same',1);const key=gaussianShadowKey(scene);
 expect(native.castShadow).toBe(true);expect(native.receiveShadow).toBe(false);expect(index.reflective).not.toContain(native);
 expect(light.shadow.camera.layers.isEnabled(GAUSSIAN_SURFACE_LAYER)).toBe(true);
 camera.position.z=10;expect(gaussianShadowKey(scene)).toBe(key);expect(index.update(r,scene,DEFAULT_QUALITY,'same',1)).toBe(false);
 native.material.uniforms.surfaceMode!.value=1;expect(gaussianShadowKey(scene)).toBe(key);
 expect(index.update(r,scene,{...DEFAULT_QUALITY,gaussianAlphaClip:.6},'same',1)).toBe(true);expect(native.alphaClip).toBe(.6);
 group.rotation.y=.4;expect(gaussianShadowKey(scene)).not.toBe(key);group.visible=false;expect(nativeSurfaceDiagnostics(scene).visibleInstances).toBe(0);
 native.dispose();data.dispose();
});
test('surface passes restore color masks, override and camera even if drawing throws',async()=>{
 const data=await packed(),native=new GaussianSurface(data),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),override=new THREE.MeshBasicMaterial();scene.add(native);scene.overrideMaterial=override;camera.layers.enable(1);const mask=camera.layers.mask;
 const r=renderer(()=>{expect(scene.overrideMaterial).toBeNull();expect(native.material.colorWrite).toBe(true);expect(camera.layers.mask).toBe(1<<GAUSSIAN_SURFACE_LAYER);throw new Error('draw');});
 expect(()=>renderGaussianSurfaces(r,scene,camera,'normal')).toThrow('draw');expect(native.material.colorWrite).toBe(false);expect(camera.layers.mask).toBe(mask);expect(scene.overrideMaterial).toBe(override);expect(r.autoClear).toBe(true);
 native.dispose();data.dispose();override.dispose();
});
test('projection adapter guards the actual published Spark source and only changes the geometry input',async()=>{
 const spark=new SparkRenderer({renderer:renderer()}),source=spark.material.vertexShader;
 try{const patched=nativeSurfaceVertex(source);expect(patched).toContain('uint splatIndex = uint(gl_InstanceID)');expect(patched).not.toContain('rgba.a *= 2.0;');expect(patched).toContain('mat3(modelViewMatrix) * scaleQuaternionToMatrix');expect(patched).toContain('normalMatrix * quatVec');expect(()=>nativeSurfaceVertex(source.replace('vec4 viewQuaternion','vec4 differentQuaternion'))).not.toThrow();expect(()=>nativeSurfaceVertex(source.replace('mat3 RS = scaleQuaternionToMatrix(scales, viewQuaternion);','changed();'))).toThrow('SPARK_SURFACE_SHADER_CHANGED');}finally{spark.dispose();}
});
test('production no-proxy load attaches native geometry in the same transform and removes it before the last source release',async()=>{
 const data=await packed(),owner=new SplatMesh({packedSplats:data});let releases=0;const runtime={assets:{acquire:()=>({ready:Promise.resolve({owner,packed:data,inputSplats:2,loadMs:0,decodeAndLodMs:0}),release:()=>{releases++;}})},retainVisual:()=>()=>{}} as unknown as GaussianRuntime;
 const visual=new GaussianAvatarVisual(runtime),manifest={...gaussianFixture(0).manifest};delete manifest.proxy;
 const p={kind:'gaussian' as const,userId:'1',assetId:'a'.repeat(64),manifest,scale:1.4,yawRad:.5,offsetX:0,offsetY:0,offsetZ:0};
 await visual.setProfile(p);expect(visual.proxyRoot).toBeUndefined();expect(visual.surface).toBeInstanceOf(GaussianSurface);expect(visual.surface!.parent).toBe(visual.model);
 visual.update(0,0);expect(visual.surface!.visible).toBe(false);visual.update(.45,0);expect(visual.surface!.visible).toBe(true);
 const geometry=visual.surface;await visual.setProfile({...p,scale:1.2});expect(visual.surface).toBe(geometry);
 visual.dispose();expect(geometry!.parent).toBeNull();expect(releases).toBe(1);owner.dispose();
});

test('distributed native examples include eight distinct original sources and no proxy meshes',async()=>{
 const {gaussianFixturePackages}=await import('../../scripts/generate-gaussian-fixtures.ts');
 const {unzipSync,strFromU8}=await import('fflate');const {createHash}=await import('node:crypto');
 const files=gaussianFixturePackages(),hashes=new Set<string>();
 for(let i=1;i<=8;i++){
  const archive=files[`character-${String(i).padStart(2,'0')}-native.entaku.zip`]!;expect(archive).toBeDefined();
  const raw=unzipSync(archive),manifest=JSON.parse(strFromU8(raw['manifest.json']!));expect(manifest.proxy).toBeUndefined();expect(Object.keys(raw).sort()).toEqual(['avatar.ply','manifest.json']);
  hashes.add(createHash('sha256').update(raw['avatar.ply']!).digest('hex'));
 }
 expect(hashes.size).toBe(8);expect(JSON.parse(strFromU8(files['fixtures.json']!)).nativeCharacters).toHaveLength(8);
});
