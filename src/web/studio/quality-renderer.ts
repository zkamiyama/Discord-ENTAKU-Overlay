import {SceneEffectsIndex} from './scene-effects-index.ts';
import {saveRenderState} from './render-state.ts';
import {EffectTargets} from './effect-targets.ts';
import {RenderRecovery} from './render-recovery.ts';
import {createReflectionPass,disposeReflectionPass} from './addon-adapters.ts';
import {STUDIO_UNLIT_LAYER} from './studio-materials.ts';
import {DisplayComposite} from './display-composite.ts';
import {PostRenderer} from './post-renderer.ts';
import {DEFAULT_POST,hasPostEffects,type PostSettings,type FocusBand} from '../../studio/post-effects.ts';
import {SSGIPass} from './ssgi-pass.ts';
import {GAUSSIAN_COLOR_LAYER,GAUSSIAN_PROXY_LAYER,hasGaussianColor,renderSceneWithGaussians} from './gaussian-layers.ts';
import {GaussianReflectionInputs} from './gaussian-reflections.ts';
import * as THREE from 'three';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import type {SSRPass} from 'three/addons/postprocessing/SSRPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {FXAAPass} from 'three/addons/postprocessing/FXAAPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {hasScreenEffects,effectiveSamples,type QualitySettings} from '../../studio/quality.ts';
export type QualityStatus='DIRECT'|'EFFECTS'|'EFFECTS_UNAVAILABLE'|'EFFECTS_FAILED';
/** Official passes compute effects. This adapter alone restores scene depth before
 * drawing display-layer avatars, keeping their RGB outside AO, SSR and AgX. */
export class QualityRenderer {
 private post?:PostRenderer;private displayComposite?:DisplayComposite;
 private gi?:SSGIPass;
 private gaussianReflections?:GaussianReflectionInputs;
 private targets=new EffectTargets();
 private get world(){return this.targets.get('world');}
 private get work(){return this.targets.get('work');}
 private get aoTarget(){return this.targets.get('ao');}
 private get giTarget(){return this.targets.get('gi');}
 private get reflections(){return this.targets.get('reflections');}
 private get mapped(){return this.targets.get('mapped');}
 private get antialiased(){return this.targets.get('antialiased');}
 private reflectionBlend?:FullScreenQuad;
 private ao?:GTAOPass;private ssr?:SSRPass;private output?:OutputPass;private fxaa?:FXAAPass;private screen?:FullScreenQuad;
 private w=0;private h=0;private passScene?:THREE.Scene;private passCamera?:THREE.Camera;
 private index=new SceneEffectsIndex();
 private sampleCounts?:number[];private recovery=new RenderRecovery();
 status:QualityStatus='DIRECT';msaaSamples=0;get shadowLights():number{return this.index.lights.length;}
 constructor(private renderer:THREE.WebGLRenderer,private displayLayer=1){}
 private allocate(scene:THREE.Scene,camera:THREE.PerspectiveCamera):void{
  if(this.targets.has('world')&&this.passScene===scene&&this.passCamera===camera)return;
  this.releaseEffects();this.passScene=scene;this.passCamera=camera;
  this.targets.get('world');
  this.reflectionBlend=new FullScreenQuad(new THREE.ShaderMaterial({
   uniforms:{base:{value:null},reflection:{value:null},mask:{value:null}},depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
   vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:'uniform sampler2D base,reflection,mask;varying vec2 v;void main(){vec4 b=texture2D(base,v),r=texture2D(reflection,v);gl_FragColor=b;float receiver=texture2D(mask,v).r;if(any(isnan(r))||any(isinf(r)))return;if(receiver>0.&&r.a>0.)gl_FragColor.rgb+=max(r.rgb,vec3(0.))*clamp(r.a,0.,1.)*receiver;}'
  }));
  this.output=new OutputPass();this.output.material.depthTest=false;this.output.material.depthWrite=false;
  this.fxaa=new FXAAPass();
  const material=new THREE.ShaderMaterial({
   uniforms:{color:{value:null},depth:{value:null},coverage:{value:null}},toneMapped:false,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,
   vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
   // A fullscreen color copy would discard world depth and make avatars float over
   // the tabletop. Depth is copied with the same UV and camera projection.
   fragmentShader:'uniform sampler2D color,depth,coverage;varying vec2 uv0;void main(){gl_FragColor=texture2D(color,uv0);gl_FragColor.a=texture2D(coverage,uv0).a;gl_FragDepth=texture2D(depth,uv0).r;}'
  });
  this.screen=new FullScreenQuad(material);
 }
 render(scene:THREE.Scene,camera:THREE.Camera,q:QualitySettings,source:string,p:PostSettings=DEFAULT_POST,focus:FocusBand={distance:6,range:.5},forceComposite=false):void{
  const renderer=this.renderer;
  camera.layers.enable(STUDIO_UNLIT_LAYER);camera.layers.disable(GAUSSIAN_PROXY_LAYER);
  this.index.update(renderer,scene,q,source,this.displayLayer);
  if(!forceComposite&&!hasScreenEffects(q)&&!hasPostEffects(p)){this.msaaSamples=0;this.releaseEffects();this.recovery.reset();this.status='DIRECT';renderSceneWithGaussians(renderer,scene,camera);return;}
  if(!(camera instanceof THREE.PerspectiveCamera)||!renderer.extensions.has('EXT_color_buffer_float')){this.status='EFFECTS_UNAVAILABLE';renderSceneWithGaussians(renderer,scene,camera);return;}
  const mask=camera.layers.mask,target=renderer.getRenderTarget(),auto=renderer.autoClear,background=scene.background;
  const size=target?new THREE.Vector2(target.width,target.height):renderer.getDrawingBufferSize(new THREE.Vector2()),w=size.x,h=size.y;
  if(!this.recovery.canAttempt(JSON.stringify([source,camera.uuid,w,h,q,p]))){this.status='EFFECTS_FAILED';renderSceneWithGaussians(renderer,scene,camera);return;}
  const restore=saveRenderState(renderer,scene,camera);
  const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
  try{
   this.allocate(scene,camera);
   if(!this.sampleCounts){
    // r187 WebGLRenderer is WebGL2-only. Query the actual color/depth formats,
    // not just MAX_SAMPLES: 8x is often unavailable for RGBA16F attachments.
    const gl=renderer.getContext() as WebGL2RenderingContext;
    const color=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES) as Int32Array);
    const depth=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,gl.SAMPLES) as Int32Array);
    this.sampleCounts=color.filter(n=>depth.includes(n)).sort((a,b)=>b-a);
   }
   const samples=effectiveSamples(q.msaa,this.sampleCounts,renderer.capabilities.maxSamples);
   if(this.world!.samples!==samples){this.world!.dispose();this.world!.samples=samples;}this.msaaSamples=samples;
   if(w!==this.w||h!==this.h){this.w=w;this.h=h;this.targets.setSize(w,h);}
   camera.layers.disable(this.displayLayer);camera.layers.disable(GAUSSIAN_COLOR_LAYER);camera.layers.disable(GAUSSIAN_PROXY_LAYER);camera.layers.disable(STUDIO_UNLIT_LAYER);renderer.setScissorTest(false);renderer.autoClear=true;
   renderer.shadowMap.autoUpdate=false;
   renderer.setRenderTarget(this.world!);renderer.clear();renderer.render(scene,camera);
   let input=this.world!;
   if(q.gi==='ssgi'){
    this.gi??=new SSGIPass();this.gi.render(renderer,scene,camera,input,this.world!.depthTexture!,this.giTarget!,q);input=this.giTarget!;
   }else if(this.gi){this.gi.dispose();this.gi=undefined;this.targets.release('gi');}
   if(q.reflections){
    if(!this.ssr){
     this.ssr=createReflectionPass({renderer,scene,camera,width:w,height:h,selects:[],groundReflector:null});
    }
    if(this.ssr.resolutionScale!==q.effectsScale)this.ssr.resolutionScale=q.effectsScale;if(this.ssr.width!==w||this.ssr.height!==h)this.ssr.setSize(w,h);
    this.ssr.ssrMaterial.uniforms.cameraProjectionMatrix!.value.copy(camera.projectionMatrix);this.ssr.ssrMaterial.uniforms.cameraInverseProjectionMatrix!.value.copy(camera.projectionMatrixInverse);this.ssr.opacity=q.reflectionOpacity;this.ssr.maxDistance=8;this.ssr.thickness=.035;this.ssr.bouncing=false;
    // Avoid making rough plaster and every wall a mirror. Render scene-colored reflections only on selected smooth surfaces.
    this.ssr.selects=this.index.reflective;
    this.ssr.ssrMaterial.uniforms.cameraNear!.value=camera.near;this.ssr.ssrMaterial.uniforms.cameraFar!.value=camera.far;
    if(hasGaussianColor(scene)){
     this.gaussianReflections??=new GaussianReflectionInputs();
     this.gaussianReflections.render(this.ssr,renderer,scene,camera,input,this.world!.depthTexture!,this.reflections!);
    }else{
     this.gaussianReflections?.dispose();this.gaussianReflections=undefined;
     this.ssr.render(renderer,this.reflections!,input,0,false);
    }
    // Never replace the MSAA beauty with SSRPass's separate, non-MSAA beauty.
    // Reapply its receiver mask after the reflection blur to stop wall bleeding.
    const u=(this.reflectionBlend!.material as THREE.ShaderMaterial).uniforms;
    u.base!.value=input.texture;u.reflection!.value=this.reflections!.texture;u.mask!.value=this.ssr.metalnessRenderTarget.texture;
    renderer.setRenderTarget(this.work!);renderer.clear();this.reflectionBlend!.render(renderer);input=this.work!;
   }else if(this.ssr){disposeReflectionPass(this.ssr);this.ssr=undefined;this.gaussianReflections?.dispose();this.gaussianReflections=undefined;this.targets.release('reflections');this.targets.release('work');}
   if(q.ao==='gtao'){
    this.ao??=new GTAOPass(scene,camera,w,h,{depthTexture:this.world!.depthTexture!});
    const aw=Math.max(1,Math.round(w*q.effectsScale)),ah=Math.max(1,Math.round(h*q.effectsScale));if(this.ao.width!==aw||this.ao.height!==ah)this.ao.setSize(aw,ah);
    this.ao.blendIntensity=q.aoStrength;this.ao.updateGtaoMaterial({radius:q.aoRadius,distanceExponent:1,thickness:1,scale:1,samples:8});
    this.ao.render(renderer,this.aoTarget!,input,0,false);input=this.aoTarget!;
   }else if(this.ao){this.ao.dispose();this.ao=undefined;this.targets.release('ao');}
   const postActive=hasPostEffects(p),postUsed=postActive||this.index.hasUnlit;
   let color:THREE.WebGLRenderTarget;
   if(postUsed){this.post??=new PostRenderer(this.displayLayer);color=this.post.render(renderer,scene,camera,input,this.world!.depthTexture!,postActive?p:{...DEFAULT_POST,enabled:false,saturation:1,contrast:1,bloom:false,dof:false},focus,this.msaaSamples,this.index.hasUnlit);}
   else {this.post?.dispose();this.post=undefined;this.output!.render(renderer,this.mapped!,input,0,false);color=this.mapped!;}
   const compositeDepth=postUsed?this.post!.depthTexture:this.world!.depthTexture!;
   let coverage=postUsed?color.texture:this.world!.texture;
   if(q.fxaa){this.fxaa!.setSize(w,h);this.fxaa!.render(renderer,this.antialiased!,color,0,false);color=this.antialiased!;}else this.targets.release('antialiased');
   if(target&&(!postActive||p.excludeAvatars)){
    this.displayComposite??=new DisplayComposite(this.displayLayer);
    color=this.displayComposite.render(renderer,scene,camera,color,compositeDepth,this.msaaSamples);coverage=color.texture;
   }
   const uniforms=(this.screen!.material as THREE.ShaderMaterial).uniforms;
   uniforms.color!.value=color.texture;uniforms.depth!.value=compositeDepth;uniforms.coverage!.value=coverage;
   renderer.setRenderTarget(target);renderer.autoClear=false;renderer.clear();this.screen!.render(renderer);
   if(!target&&(!postActive||p.excludeAvatars)){camera.layers.set(this.displayLayer);scene.background=null;renderSceneWithGaussians(renderer,scene,camera);}
   this.recovery.succeeded();this.status='EFFECTS';
  }catch(error){
   console.warn('QUALITY_EFFECTS_FAILED',error instanceof Error?error.name:'Unknown');this.recovery.failed();this.releaseEffects();this.status='EFFECTS_FAILED';
   camera.layers.mask=mask;scene.background=background;renderer.autoClear=auto;renderer.setRenderTarget(target);renderer.setClearColor(clear,alpha);renderSceneWithGaussians(renderer,scene,camera);
  }finally{
   restore();
  }
 }
 private releaseEffects():void{
  this.displayComposite?.dispose();this.displayComposite=undefined;
  this.post?.dispose();this.post=undefined;
  this.gi?.dispose();this.gi=undefined;
  this.gaussianReflections?.dispose();this.gaussianReflections=undefined;
  this.ao?.dispose();if(this.ssr)disposeReflectionPass(this.ssr);this.output?.dispose();this.fxaa?.dispose();
  if(this.screen){this.screen.material.dispose();this.screen.dispose();}
  this.targets.dispose();
  if(this.reflectionBlend){this.reflectionBlend.material.dispose();this.reflectionBlend.dispose();this.reflectionBlend=undefined;}
  this.ao=undefined;this.ssr=undefined;this.output=undefined;this.fxaa=undefined;this.screen=undefined;this.w=this.h=0;
 }
 dispose():void{this.releaseEffects();this.recovery.reset();this.index.invalidate();}
}
