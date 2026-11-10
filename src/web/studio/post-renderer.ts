import {renderGaussianSurfaces} from '../gaussian/surface.ts';
import {saveRenderState} from './render-state.ts';
import {createFocusMaterial,bloomTexture} from './addon-adapters.ts';
import {STUDIO_UNLIT_LAYER} from './studio-materials.ts';
import {GaussianProxyDepthPass,renderSceneWithGaussians} from './gaussian-layers.ts';
import * as THREE from 'three';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {VibranceShader} from './vibrance-shader.ts';
import {BrightnessContrastShader} from 'three/addons/shaders/BrightnessContrastShader.js';
import type {FocusBand,PostSettings} from '../../studio/post-effects.ts';
const vertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
function screen(uniforms:Record<string,THREE.IUniform>,fragmentShader:string):FullScreenQuad {
 return new FullScreenQuad(new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader,toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending}));
}
/** Tone-map world first, optionally add unexposed display art, then apply lens effects.
 * Bloom threshold is linear DISPLAY luminance (0..1), independent of GLB light units.
 * Official filters stay intact except Bokeh's sharp band and alpha preservation.
 */
export class PostRenderer {
 private linear=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
 private a=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
 private b=this.a.clone();private c=this.a.clone();
 private result=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
 private tone=new OutputPass();private hue=new ShaderPass(VibranceShader);private contrast=new ShaderPass(BrightnessContrastShader);
 private bokeh:ShaderPass;private bloom?:UnrealBloomPass;
 private proxyDepth?:GaussianProxyDepthPass;
 private depth:FullScreenQuad;private blend:FullScreenQuad;private gamma:FullScreenQuad;private premultiply:FullScreenQuad;
 private w=0;private h=0;
 get depthTexture():THREE.DepthTexture{return this.linear.depthTexture!;}
 constructor(private displayLayer:number){
  this.linear.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.tone.material.depthTest=this.tone.material.depthWrite=false;
  for(const pass of [this.hue,this.contrast]){pass.material.toneMapped=false;pass.material.depthTest=pass.material.depthWrite=false;}
  this.bokeh=new ShaderPass(createFocusMaterial(),'tColor');
  this.depth=screen({depth:{value:null}},'varying vec2 vUv;uniform sampler2D depth;void main(){gl_FragDepth=texture2D(depth,vUv).r;gl_FragColor=vec4(0.);}');
  const d=this.depth.material as THREE.ShaderMaterial;d.colorWrite=false;d.depthTest=d.depthWrite=true;d.depthFunc=THREE.AlwaysDepth;
  this.blend=screen({base:{value:null},glow:{value:null}},'varying vec2 vUv;uniform sampler2D base,glow;void main(){vec4 b=texture2D(base,vUv);vec3 g=max(texture2D(glow,vUv).rgb,vec3(0.));float a=clamp(b.a+max(max(g.r,g.g),g.b),0.,1.);gl_FragColor=vec4(b.rgb+g,a);}');
  this.gamma=screen({color:{value:null}},'varying vec2 vUv;uniform sampler2D color;void main(){vec4 c=texture2D(color,vUv);c.rgb=c.a>0.000001?max(c.rgb/c.a,vec3(0.)):vec3(0.);gl_FragColor=sRGBTransferOETF(c);}');
  this.premultiply=screen({color:{value:null}},'varying vec2 vUv;uniform sampler2D color;void main(){vec4 c=texture2D(color,vUv);gl_FragColor=vec4(clamp(c.rgb,0.,1.)*c.a,c.a);}');
 }
 render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,input:THREE.WebGLRenderTarget,worldDepth:THREE.DepthTexture,p:PostSettings,focus:FocusBand,samples:number,unlitStudio=false):THREE.WebGLRenderTarget {
  const displaySamples=p.excludeAvatars&&!unlitStudio?0:samples;
  if(this.linear.samples!==displaySamples){this.linear.dispose();this.linear.samples=displaySamples;}
  if(this.w!==input.width||this.h!==input.height){this.w=input.width;this.h=input.height;for(const rt of [this.linear,this.a,this.b,this.c,this.result])rt.setSize(this.w,this.h);this.bloom?.setSize(this.w,this.h);}
  const restore=saveRenderState(renderer,scene,camera);
  const outputSpace=renderer.outputColorSpace,mask=camera.layers.mask,background=scene.background;
  try{
   // OutputPass reads renderer outputColorSpace. No second AgX/exposure is applied to display art.
   renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.autoClear=true;
   this.tone.render(renderer,this.linear,input,0,false);
   (this.depth.material as THREE.ShaderMaterial).uniforms.depth!.value=worldDepth;
   renderer.setRenderTarget(this.linear);renderer.autoClear=false;this.depth.render(renderer);
   if(unlitStudio||!p.excludeAvatars){camera.layers.mask=0;if(unlitStudio)camera.layers.enable(STUDIO_UNLIT_LAYER);if(!p.excludeAvatars)camera.layers.enable(this.displayLayer);scene.background=null;renderSceneWithGaussians(renderer,scene,camera);}
   if(!p.excludeAvatars&&p.dof){this.proxyDepth??=new GaussianProxyDepthPass();this.proxyDepth.render(renderer,scene,camera);renderGaussianSurfaces(renderer,scene,camera,'depth');}
   renderer.outputColorSpace=outputSpace;camera.layers.mask=mask;scene.background=background;renderer.autoClear=true;
   let color=this.linear;
   if(p.dof&&p.maxBlur>0&&p.aperture>0){
    const u=this.bokeh.uniforms;u.tDepth!.value=p.excludeAvatars&&!unlitStudio?worldDepth:this.linear.depthTexture;u.focus!.value=focus.distance;u.sharpRange!.value=focus.range;
    u.aspect!.value=camera.aspect;u.aperture!.value=p.aperture;u.maxblur!.value=p.maxBlur*2.5/Math.max(1,this.w/renderer.getPixelRatio());u.nearClip!.value=camera.near;u.farClip!.value=camera.far;
    this.bokeh.render(renderer,this.a,color,0,false);color=this.a;
   }
   if(p.bloom&&p.bloomStrength>0){
    if(!this.bloom){this.bloom=new UnrealBloomPass(new THREE.Vector2(this.w,this.h),p.bloomStrength,p.bloomRadius,p.bloomThreshold);this.bloom.blendMaterial.colorWrite=false;}
    this.bloom.threshold=p.bloomThreshold;this.bloom.strength=p.bloomStrength;this.bloom.radius=p.bloomRadius;
    // Official blur/mip chain generates bloom; alpha-aware composition is application glue.
    this.bloom.render(renderer,this.b,color,0,false);
    const u=(this.blend.material as THREE.ShaderMaterial).uniforms;u.base!.value=color.texture;u.glow!.value=bloomTexture(this.bloom);
    renderer.setRenderTarget(this.b);this.blend.render(renderer);color=this.b;
   }else if(this.bloom){this.bloom.dispose();this.bloom=undefined;}
   (this.gamma.material as THREE.ShaderMaterial).uniforms.color!.value=color.texture;renderer.setRenderTarget(this.c);this.gamma.render(renderer);color=this.c;
   if(p.saturation!==1){this.hue.uniforms.amount!.value=p.saturation;this.hue.render(renderer,this.a,color,0,false);color=this.a;}
   if(p.contrast!==1){this.contrast.uniforms.contrast!.value=p.contrast>=1?1-1/p.contrast:p.contrast-1;this.contrast.render(renderer,this.b,color,0,false);color=this.b;}
   (this.premultiply.material as THREE.ShaderMaterial).uniforms.color!.value=color.texture;renderer.setRenderTarget(this.result);this.premultiply.render(renderer);
   return this.result;
  }finally{restore();}
 }
 dispose():void{
  for(const rt of [this.linear,this.a,this.b,this.c,this.result])rt.dispose();
  for(const pass of [this.tone,this.hue,this.contrast,this.bokeh])pass.dispose();this.bloom?.dispose();
  this.proxyDepth?.dispose();this.proxyDepth=undefined;
  for(const quad of [this.depth,this.blend,this.gamma,this.premultiply]){quad.material.dispose();quad.dispose();}
 }
}
