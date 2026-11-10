import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {SparkRenderer} from '@sparkjsdev/spark';
import {prepareGaussianColor} from '../../src/web/gaussian/color-space.ts';
import {createReflectionPass,disposeReflectionPass,reflectionInternals,renderPreparedReflection} from '../../src/web/studio/addon-adapters.ts';
import {GAUSSIAN_COLOR_LAYER,GAUSSIAN_PROXY_LAYER,GaussianProxyDepthPass,gaussianShadowKey,hasGaussianColor,installGaussianRenderHook,renderSceneWithGaussians} from '../../src/web/studio/gaussian-layers.ts';
import {GaussianReflectionInputs} from '../../src/web/studio/gaussian-reflections.ts';
import {SceneEffectsIndex} from '../../src/web/studio/scene-effects-index.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';

function proxy(){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false}));
 mesh.layers.set(GAUSSIAN_PROXY_LAYER);mesh.userData.entakuGaussianProxy=true;return mesh;
}
function fakeRenderer(render:(scene:THREE.Scene,camera:THREE.Camera)=>void){
 let target:THREE.WebGLRenderTarget|null=null;
 return {
  autoClear:true,outputColorSpace:THREE.SRGBColorSpace,shadowMap:{autoUpdate:false},
  getRenderTarget:()=>target,setRenderTarget:(v:THREE.WebGLRenderTarget|null)=>{target=v;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getViewport:(v:THREE.Vector4)=>v.set(0,0,100,100),getScissor:(v:THREE.Vector4)=>v.set(0,0,100,100),getScissorTest:()=>false,
  getClearColor:(v:THREE.Color)=>v.set(0),getClearAlpha:()=>0,setClearColor:()=>{},setClearAlpha:()=>{},setViewport:()=>{},setScissor:()=>{},setScissorTest:()=>{},clear:()=>{},render,
 } as unknown as THREE.WebGLRenderer;
}
test('published Spark fragment uses Three sRGB decoding and rejects a changed conversion hook',()=>{
 // Construct the actual packaged material; no shader source fixture is copied.
 // No WebGL drawing occurs in this source-compatibility test.
 const renderer={getContext:()=>({getExtension:()=>null})} as unknown as THREE.WebGLRenderer;
 const spark=new SparkRenderer({renderer}),material=spark.material,original=material.fragmentShader,version=material.version;
 try{
  expect(original).toContain('if (encodeLinear)');expect(original).toContain('rgba.rgb = srgbToLinear(rgba.rgb);');
  prepareGaussianColor(material);
  expect(material.fragmentShader).toBe(original.replace('rgba.rgb = srgbToLinear(rgba.rgb);','rgba.rgb = sRGBTransferEOTF(vec4(rgba.rgb, 1.0)).rgb;'));
  expect(material.version).toBe(version+1);
  expect(()=>prepareGaussianColor(material)).toThrow('SPARK_COLOR_ADAPTER_CHANGED');
  material.fragmentShader=original.replace('srgbToLinear(rgba.rgb)','updatedDecode(rgba.rgb)');
  expect(()=>prepareGaussianColor(material)).toThrow('SPARK_COLOR_ADAPTER_CHANGED');
 }finally{spark.dispose();}
});
test('view hook receives display/color draws while geometry and metering stay native',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();let native=0,gaussian=0;
 const renderer=fakeRenderer(()=>native++),release=installGaussianRenderHook(scene,()=>gaussian++);
 renderSceneWithGaussians(renderer,scene,camera);expect(native).toBe(1);expect(gaussian).toBe(0);
 camera.layers.set(1);renderSceneWithGaussians(renderer,scene,camera);
 camera.layers.set(GAUSSIAN_COLOR_LAYER);renderSceneWithGaussians(renderer,scene,camera);expect(gaussian).toBe(2);
 camera.layers.set(GAUSSIAN_PROXY_LAYER);renderSceneWithGaussians(renderer,scene,camera);expect(native).toBe(2);
 release();camera.layers.set(1);renderSceneWithGaussians(renderer,scene,camera);expect(native).toBe(3);
});
test('proxy depth pass preserves caller layers, target and override even on a draw error',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),mesh=proxy(),prior=new THREE.MeshNormalMaterial();scene.add(mesh);scene.overrideMaterial=prior;
 camera.layers.enable(1);const mask=camera.layers.mask,target=new THREE.WebGLRenderTarget(),pass=new GaussianProxyDepthPass();
 const renderer=fakeRenderer((s,c)=>{
  expect(c.layers.isEnabled(GAUSSIAN_PROXY_LAYER)).toBe(true);expect(c.layers.isEnabled(1)).toBe(false);
  expect(s.overrideMaterial?.colorWrite).toBe(false);expect(s.overrideMaterial?.depthWrite).toBe(true);throw new Error('GPU draw failed');
 });
 renderer.setRenderTarget(target);
 expect(()=>pass.render(renderer,scene,camera)).toThrow('GPU draw failed');
 expect(camera.layers.mask).toBe(mask);expect(scene.overrideMaterial).toBe(prior);expect(renderer.getRenderTarget()).toBe(target);expect(renderer.autoClear).toBe(true);
 pass.dispose();target.dispose();prior.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
test('proxy transformations and light changes invalidate shadows, camera-only changes do not',()=>{
 const scene=new THREE.Scene(),root=new THREE.Group(),mesh=proxy(),light=new THREE.DirectionalLight(),camera=new THREE.PerspectiveCamera();root.add(mesh);scene.add(root,light,camera);
 const start=gaussianShadowKey(scene);camera.position.set(3,2,1);camera.lookAt(0,0,0);expect(gaussianShadowKey(scene)).toBe(start);
 root.position.x=2;const moved=gaussianShadowKey(scene);expect(moved).not.toBe(start);
 light.position.y=3;const lighting=gaussianShadowKey(scene);expect(lighting).not.toBe(moved);
 root.visible=false;const departed=gaussianShadowKey(scene);expect(departed).not.toBe(lighting);root.visible=true;expect(gaussianShadowKey(scene)).toBe(lighting);
 mesh.geometry.dispose();mesh.material.dispose();
});
test('scene index casts proxy shadows, excludes Spark and never selects proxy as a receiver',()=>{
 const scene=new THREE.Scene(),mesh=proxy(),spark=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({roughness:0})),light=new THREE.DirectionalLight();
 spark.userData.entakuGaussianRenderer=true;spark.castShadow=true;mesh.userData.entakuReflective=true;scene.add(mesh,spark,light);
 const renderer=fakeRenderer(()=>{}),index=new SceneEffectsIndex();index.update(renderer,scene,DEFAULT_QUALITY,'same',1);
 expect(spark.castShadow).toBe(false);expect(mesh.castShadow).toBe(true);expect(mesh.receiveShadow).toBe(false);expect(index.reflective).not.toContain(mesh);
 expect(light.shadow.camera.layers.isEnabled(GAUSSIAN_PROXY_LAYER)).toBe(true);expect(light.shadow.camera.layers.isEnabled(1)).toBe(false);
 expect(index.update(renderer,scene,DEFAULT_QUALITY,'same',1)).toBe(false);mesh.position.x=2;expect(index.update(renderer,scene,DEFAULT_QUALITY,'same',1)).toBe(true);
 mesh.geometry.dispose();mesh.material.dispose();spark.geometry.dispose();spark.material.dispose();
});
test('pinned official SSR input bridge rejects missing hooks and restores material after failures',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),mesh=proxy();scene.add(mesh);
 const renderer=fakeRenderer(()=>{}),pass=createReflectionPass({renderer,scene,camera,selects:[],groundReflector:null}),bridge=reflectionInternals(pass);
 expect(pass.ssrMaterial.uniforms.tDepth!.value).toBe(pass.beautyRenderTarget.depthTexture);
 const render=bridge._renderPass;
 (bridge as unknown as Record<string,unknown>)._renderPass=undefined;
 expect(()=>reflectionInternals(pass)).toThrow('THREE_SSR_INPUT_ADAPTER_CHANGED');bridge._renderPass=render;
 const material=mesh.material,override=new THREE.MeshBasicMaterial();scene.overrideMaterial=override;
 bridge._renderOverride=()=>{};bridge._renderMetalness=()=>{mesh.material=pass.metalnessOffMaterial;throw new Error('mask draw failed');};
 const target=new THREE.WebGLRenderTarget();expect(()=>renderPreparedReflection(pass,renderer,target)).toThrow('mask draw failed');
 expect(mesh.material).toBe(material);expect(scene.overrideMaterial).toBe(override);
 disposeReflectionPass(pass);mesh.geometry.dispose();mesh.material.dispose();override.dispose();target.dispose();
});
test('initial SSR input draws Gaussian color before proxy depth and never writes the main world target',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),mesh=proxy(),instance=new THREE.Object3D();
 instance.userData.entakuGaussianInstance=true;instance.layers.set(1);instance.layers.enable(GAUSSIAN_COLOR_LAYER);scene.add(mesh,instance);
 // Real SplatMesh is an Object3D rather than a normal Mesh. Its membership must
 // trigger SSR even before the runtime lazily creates the scene's draw node.
 expect(hasGaussianColor(scene)).toBe(true);
 const world=new THREE.WebGLRenderTarget(32,32);world.depthTexture=new THREE.DepthTexture(32,32,THREE.UnsignedIntType);
 const depth=world.depthTexture,output=new THREE.WebGLRenderTarget(32,32),phases:string[]=[];
 const renderer=fakeRenderer((s,c)=>{
  if(s!==scene)return;
  expect(renderer.getRenderTarget()).not.toBe(world);
  if(c.layers.isEnabled(GAUSSIAN_COLOR_LAYER)){
   expect(c.layers.isEnabled(GAUSSIAN_PROXY_LAYER)).toBe(false);expect(s.overrideMaterial).toBeNull();phases.push('color');
  }else if(s.overrideMaterial?.colorWrite===false){
   expect(c.layers.isEnabled(0)).toBe(false);expect(c.layers.isEnabled(GAUSSIAN_PROXY_LAYER)).toBe(true);phases.push('proxy-depth');
  }else if(s.overrideMaterial instanceof THREE.MeshNormalMaterial){
   expect(c.layers.isEnabled(0)).toBe(true);expect(c.layers.isEnabled(GAUSSIAN_PROXY_LAYER)).toBe(true);expect(c.layers.isEnabled(1)).toBe(false);phases.push('normal');
  }else {expect(c.layers.isEnabled(GAUSSIAN_COLOR_LAYER)).toBe(false);phases.push('receiver-mask');}
 });
 const release=installGaussianRenderHook(scene,c=>renderer.render(scene,c));
 const pass=createReflectionPass({renderer,scene,camera,selects:[],groundReflector:null,width:32,height:32}),inputs=new GaussianReflectionInputs();
 renderer.setRenderTarget(world);inputs.render(pass,renderer,scene,camera,world,depth,output);
 expect(phases).toEqual(['color','proxy-depth','normal','receiver-mask']);
 expect(world.depthTexture).toBe(depth);expect(renderer.getRenderTarget()).toBe(world);expect(camera.layers.mask).toBe(1);expect(scene.overrideMaterial).toBeNull();
 release();inputs.dispose();disposeReflectionPass(pass);world.dispose();output.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
