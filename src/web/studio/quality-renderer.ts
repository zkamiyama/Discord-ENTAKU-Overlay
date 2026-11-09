import {PostRenderer} from './post-renderer.ts';
import {DEFAULT_POST,hasPostEffects,type PostSettings,type FocusBand} from '../../studio/post-effects.ts';
import {SSGIPass} from './ssgi-pass.ts';
import * as THREE from 'three';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {SSRPass} from 'three/addons/postprocessing/SSRPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {FXAAPass} from 'three/addons/postprocessing/FXAAPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {hasScreenEffects,type QualitySettings} from '../../studio/quality.ts';
export type QualityStatus='DIRECT'|'EFFECTS'|'EFFECTS_UNAVAILABLE'|'EFFECTS_FAILED';
/** Official passes compute effects. This adapter alone restores scene depth before
 * drawing display-layer avatars, keeping their RGB outside AO, SSR and AgX. */
export class QualityRenderer {
 private post?:PostRenderer;
 private gi?:SSGIPass;private giTarget?:THREE.WebGLRenderTarget;
 private world?:THREE.WebGLRenderTarget;private work?:THREE.WebGLRenderTarget;private aoTarget?:THREE.WebGLRenderTarget;
 private reflections?:THREE.WebGLRenderTarget;private reflectionBlend?:FullScreenQuad;
 private mapped?:THREE.WebGLRenderTarget;private antialiased?:THREE.WebGLRenderTarget;
 private ao?:GTAOPass;private ssr?:SSRPass;private output?:OutputPass;private fxaa?:FXAAPass;private screen?:FullScreenQuad;
 private w=0;private h=0;private passScene?:THREE.Scene;private passCamera?:THREE.Camera;
 private shadowKey='';private lights:Array<THREE.DirectionalLight|THREE.SpotLight>=[];private desk?:THREE.Object3D;
 private sampleCounts?:number[];private failed=false;private lastOptions='';
 status:QualityStatus='DIRECT';msaaSamples=0;get shadowLights():number{return this.lights.length;}
 constructor(private renderer:THREE.WebGLRenderer,private displayLayer=1){}
 private configureShadows(scene:THREE.Scene,q:QualitySettings,source:string):void{
  const key=[source,q.shadows,q.shadowSize,q.shadowLights].join('|');
  this.renderer.shadowMap.enabled=q.shadows==='soft';this.renderer.shadowMap.type=THREE.PCFShadowMap;
  if(this.shadowKey!==key){
   this.shadowKey=key;this.lights=[];this.desk=undefined;
   const candidates:Array<THREE.DirectionalLight|THREE.SpotLight>=[];
   scene.traverse(o=>{
    if(o.userData.entakuDesk)this.desk=o;
    if(o instanceof THREE.Mesh&&!o.layers.isEnabled(this.displayLayer)){o.castShadow=true;o.receiveShadow=true;}
    if(o instanceof THREE.DirectionalLight||o instanceof THREE.SpotLight)o.castShadow=false;
   });
   scene.traverseVisible(o=>{if((o instanceof THREE.DirectionalLight||o instanceof THREE.SpotLight)&&o.intensity>0)candidates.push(o);});
   if(q.shadows==='soft')this.lights=candidates.sort((a,b)=>Number(b instanceof THREE.DirectionalLight)-Number(a instanceof THREE.DirectionalLight)||b.intensity-a.intensity).slice(0,q.shadowLights);
   for(const l of this.lights){
    l.castShadow=true;
    if(l.shadow.mapSize.x!==q.shadowSize){l.shadow.map?.dispose();l.shadow.map=null;l.shadow.mapSize.set(q.shadowSize,q.shadowSize);}
    l.shadow.bias=-.00005;l.shadow.normalBias=.012;l.shadow.radius=2.5;
    l.shadow.camera.near=.1;l.shadow.camera.far=Math.max(60,l.shadow.camera.far);l.shadow.camera.updateProjectionMatrix();l.shadow.needsUpdate=true;
   }
  }
  if(this.desk&&this.lights.length){
   this.desk.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(this.desk).expandByScalar(.5);bounds.max.y+=3;
   for(const light of this.lights)if(light instanceof THREE.DirectionalLight){
    light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);light.shadow.updateMatrices(light);
    const box=bounds.clone().applyMatrix4(light.shadow.camera.matrixWorldInverse),c=light.shadow.camera;
    c.left=box.min.x;c.right=box.max.x;c.bottom=box.min.y;c.top=box.max.y;c.near=Math.max(.05,-box.max.z);c.far=Math.max(c.near+10,-box.min.z+5);c.updateProjectionMatrix();
   }
  }
 }
 private allocate(scene:THREE.Scene,camera:THREE.PerspectiveCamera):void{
  if(this.world&&this.passScene===scene&&this.passCamera===camera)return;
  this.releaseEffects();this.passScene=scene;this.passCamera=camera;
  const rt=()=>new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,colorSpace:THREE.LinearSRGBColorSpace,depthBuffer:false,generateMipmaps:false});
  this.world=rt();this.world.depthBuffer=true;this.world.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.work=rt();this.aoTarget=rt();this.reflections=rt();this.giTarget=rt();
  this.reflectionBlend=new FullScreenQuad(new THREE.ShaderMaterial({
   uniforms:{base:{value:null},reflection:{value:null},mask:{value:null}},depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
   vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:'uniform sampler2D base,reflection,mask;varying vec2 v;void main(){vec4 b=texture2D(base,v),r=texture2D(reflection,v);gl_FragColor=b;float receiver=texture2D(mask,v).r;if(receiver>0.&&r.a>0.)gl_FragColor.rgb+=r.rgb*clamp(r.a,0.,1.)*receiver;}'
  }));
  this.mapped=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,generateMipmaps:false});this.antialiased=this.mapped.clone();
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
 render(scene:THREE.Scene,camera:THREE.Camera,q:QualitySettings,source:string,p:PostSettings=DEFAULT_POST,focus:FocusBand={distance:6,range:.5}):void{
  const renderer=this.renderer;
  this.configureShadows(scene,q,source);
  const options=JSON.stringify([q,p]);if(options!==this.lastOptions){this.failed=false;this.lastOptions=options;}
  if(!hasScreenEffects(q)&&!hasPostEffects(p)){this.msaaSamples=0;this.releaseEffects();this.status='DIRECT';renderer.render(scene,camera);return;}
  if(!(camera instanceof THREE.PerspectiveCamera)||!renderer.extensions.has('EXT_color_buffer_float')){this.status='EFFECTS_UNAVAILABLE';renderer.render(scene,camera);return;}
  if(this.failed){this.status='EFFECTS_FAILED';renderer.render(scene,camera);return;}
  const mask=camera.layers.mask,target=renderer.getRenderTarget(),auto=renderer.autoClear,background=scene.background;
  const shadowAuto=renderer.shadowMap.autoUpdate;
  const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
  const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
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
   const samples=this.sampleCounts.find(n=>n<=q.msaa&&n<=renderer.capabilities.maxSamples)??0;
   if(this.world!.samples!==samples){this.world!.dispose();this.world!.samples=samples;}this.msaaSamples=samples;
   const size=renderer.getDrawingBufferSize(new THREE.Vector2()),w=size.x,h=size.y;
   if(w!==this.w||h!==this.h){this.w=w;this.h=h;for(const rt of [this.world,this.work,this.aoTarget,this.mapped,this.antialiased,this.reflections,this.giTarget])rt!.setSize(w,h);}
   camera.layers.disable(this.displayLayer);renderer.setScissorTest(false);renderer.autoClear=true;
   renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
   renderer.setRenderTarget(this.world!);renderer.clear();renderer.render(scene,camera);
   let input=this.world!;
   if(q.gi==='ssgi'){
    this.gi??=new SSGIPass();this.gi.render(renderer,scene,camera,input,this.world!.depthTexture!,this.giTarget!,q);input=this.giTarget!;
   }else if(this.gi){this.gi.dispose();this.gi=undefined;this.giTarget?.dispose();}
   if(q.reflections){
    if(!this.ssr){
     this.ssr=new SSRPass({renderer,scene,camera,width:w,height:h,selects:[],groundReflector:null});
     // r187 defaults to 16-bit depth, which visibly quantizes closely spaced
     // GLB surfaces. Set precision before allocating the GPU texture.
     this.ssr.beautyRenderTarget.depthTexture!.type=THREE.UnsignedIntType;
     this.ssr.output=SSRPass.OUTPUT.SSR;
     this.ssr.ssrMaterial.fragmentShader=this.ssr.ssrMaterial.fragmentShader.replace('void main(){','void main(){gl_FragColor=vec4(0.);');
     for(const rt of [this.ssr.ssrRenderTarget,this.ssr.blurRenderTarget,this.ssr.blurRenderTarget2]){
      rt.texture.type=THREE.HalfFloatType;rt.texture.minFilter=rt.texture.magFilter=THREE.LinearFilter;
     }
    }
    if(this.ssr.resolutionScale!==q.effectsScale)this.ssr.resolutionScale=q.effectsScale;if(this.ssr.width!==w||this.ssr.height!==h)this.ssr.setSize(w,h);
    this.ssr.ssrMaterial.uniforms.cameraProjectionMatrix!.value.copy(camera.projectionMatrix);this.ssr.ssrMaterial.uniforms.cameraInverseProjectionMatrix!.value.copy(camera.projectionMatrixInverse);this.ssr.opacity=q.reflectionOpacity;this.ssr.maxDistance=8;this.ssr.thickness=.035;this.ssr.bouncing=false;
    // Avoid making rough plaster and every wall a mirror. Render scene-colored reflections only on selected smooth surfaces.
    const selected:THREE.Mesh[]=[];scene.traverseVisible(o=>{if(o instanceof THREE.Mesh&&!o.layers.isEnabled(this.displayLayer)){
     const materials=Array.isArray(o.material)?o.material:[o.material];
     if(o.userData.entakuReflective||materials.some(m=>m instanceof THREE.MeshStandardMaterial&&(m.metalness>.2||m.roughness<.45)))selected.push(o);
    }});this.ssr.selects=selected;
    this.ssr.ssrMaterial.uniforms.cameraNear!.value=camera.near;this.ssr.ssrMaterial.uniforms.cameraFar!.value=camera.far;
    this.ssr.render(renderer,this.reflections!,input,0,false);
    // Never replace the MSAA beauty with SSRPass's separate, non-MSAA beauty.
    // Reapply its receiver mask after the reflection blur to stop wall bleeding.
    const u=(this.reflectionBlend!.material as THREE.ShaderMaterial).uniforms;
    u.base!.value=input.texture;u.reflection!.value=this.reflections!.texture;u.mask!.value=this.ssr.metalnessRenderTarget.texture;
    renderer.setRenderTarget(this.work!);renderer.clear();this.reflectionBlend!.render(renderer);input=this.work!;
   }else if(this.ssr){this.ssr.ssrMaterial.dispose();this.ssr.dispose();this.ssr=undefined;this.reflections?.dispose();this.work?.dispose();}
   if(q.ao==='gtao'){
    this.ao??=new GTAOPass(scene,camera,w,h,{depthTexture:this.world!.depthTexture!});
    const aw=Math.max(1,Math.round(w*q.effectsScale)),ah=Math.max(1,Math.round(h*q.effectsScale));if(this.ao.width!==aw||this.ao.height!==ah)this.ao.setSize(aw,ah);
    this.ao.blendIntensity=q.aoStrength;this.ao.updateGtaoMaterial({radius:q.aoRadius,distanceExponent:1,thickness:1,scale:1,samples:8});
    this.ao.render(renderer,this.aoTarget!,input,0,false);input=this.aoTarget!;
   }else if(this.ao){this.ao.dispose();this.ao=undefined;this.aoTarget?.dispose();}
   const postActive=hasPostEffects(p);
   let color:THREE.WebGLRenderTarget;
   if(postActive){this.post??=new PostRenderer(this.displayLayer);color=this.post.render(renderer,scene,camera,input,this.world!.depthTexture!,p,focus,this.msaaSamples);}
   else {this.post?.dispose();this.post=undefined;this.output!.render(renderer,this.mapped!,input,0,false);color=this.mapped!;}
   const coverage=postActive?color.texture:this.world!.texture;
   if(q.fxaa){this.fxaa!.setSize(w,h);this.fxaa!.render(renderer,this.antialiased!,color,0,false);color=this.antialiased!;}else this.antialiased?.dispose();
   const uniforms=(this.screen!.material as THREE.ShaderMaterial).uniforms;
   uniforms.color!.value=color.texture;uniforms.depth!.value=this.world!.depthTexture;uniforms.coverage!.value=coverage;
   renderer.setRenderTarget(target);renderer.autoClear=false;renderer.clear();this.screen!.render(renderer);
   if(!postActive||p.excludeAvatars){camera.layers.set(this.displayLayer);scene.background=null;renderer.render(scene,camera);}
   this.status='EFFECTS';
  }catch(error){
   console.warn('QUALITY_EFFECTS_FAILED',error instanceof Error?error.name:'Unknown');this.failed=true;this.status='EFFECTS_FAILED';
   camera.layers.mask=mask;scene.background=background;renderer.autoClear=auto;renderer.setRenderTarget(target);renderer.setClearColor(clear,alpha);renderer.render(scene,camera);
  }finally{
   renderer.shadowMap.autoUpdate=shadowAuto;
   camera.layers.mask=mask;scene.background=background;renderer.autoClear=auto;renderer.setRenderTarget(target);renderer.setClearColor(clear,alpha);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);
  }
 }
 private releaseEffects():void{
  this.post?.dispose();this.post=undefined;
  this.gi?.dispose();this.gi=undefined;
  this.ao?.dispose();this.ssr?.ssrMaterial.dispose();this.ssr?.dispose();this.output?.dispose();this.fxaa?.dispose();
  if(this.screen){this.screen.material.dispose();this.screen.dispose();}
  for(const rt of [this.world,this.work,this.aoTarget,this.mapped,this.antialiased,this.reflections,this.giTarget])rt?.dispose();
  this.world=this.work=this.aoTarget=this.mapped=this.antialiased=this.reflections=this.giTarget=undefined;
  if(this.reflectionBlend){this.reflectionBlend.material.dispose();this.reflectionBlend.dispose();this.reflectionBlend=undefined;}
  this.ao=undefined;this.ssr=undefined;this.output=undefined;this.fxaa=undefined;this.screen=undefined;this.w=this.h=0;
 }
 dispose():void{this.releaseEffects();}
}
