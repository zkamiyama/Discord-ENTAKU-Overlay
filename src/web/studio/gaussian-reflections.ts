import * as THREE from 'three';
import {renderGaussianSurfaces,GAUSSIAN_SURFACE_LAYER} from '../gaussian/surface.ts';
import type {SSRPass} from 'three/addons/postprocessing/SSRPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {GAUSSIAN_COLOR_LAYER,GAUSSIAN_PROXY_LAYER,GaussianProxyDepthPass,renderSceneWithGaussians} from './gaussian-layers.ts';
import {reflectionInternals,renderPreparedReflection} from './addon-adapters.ts';
import {saveRenderState} from './render-state.ts';

/** Three's SSR owns its beauty target. Populate that target explicitly instead
 * of passing a readBuffer which r187 ignores. Main-view occlusion depth remains
 * the separate world target throughout this operation. */
export class GaussianReflectionInputs {
 private proxyDepth=new GaussianProxyDepthPass();
 private copy=new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms:{color:{value:null},depth:{value:null}},toneMapped:false,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,
  vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:'uniform sampler2D color,depth;varying vec2 v;void main(){gl_FragColor=texture2D(color,v);gl_FragDepth=texture2D(depth,v).r;}'
 }));
 render(pass:SSRPass,renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,color:THREE.WebGLRenderTarget,worldDepth:THREE.DepthTexture,output:THREE.WebGLRenderTarget):void {
  reflectionInternals(pass);
  const restore=saveRenderState(renderer,scene,camera),mask=camera.layers.mask,override=scene.overrideMaterial;
  try{
   const u=(this.copy.material as THREE.ShaderMaterial).uniforms;u.color!.value=color.texture;u.depth!.value=worldDepth;
   renderer.setRenderTarget(pass.beautyRenderTarget);renderer.autoClear=false;renderer.clear();this.copy.render(renderer);
   // Linear HDR world and linear, unexposed Gaussian color share the same view.
   // Gaussian alpha blends against world; proxy depth has not been written yet.
   camera.layers.set(GAUSSIAN_COLOR_LAYER);scene.background=null;scene.overrideMaterial=null;
   renderSceneWithGaussians(renderer,scene,camera);
   this.proxyDepth.render(renderer,scene,camera);
   renderGaussianSurfaces(renderer,scene,camera,'depth');
   camera.layers.mask=mask;camera.layers.disable(GAUSSIAN_SURFACE_LAYER);camera.layers.disable(1);camera.layers.disable(GAUSSIAN_COLOR_LAYER);camera.layers.enable(GAUSSIAN_PROXY_LAYER);
   renderPreparedReflection(pass,renderer,output,()=>renderGaussianSurfaces(renderer,scene,camera,'normal'));
  }finally{scene.overrideMaterial=override;restore();}
 }
 dispose():void {this.proxyDepth.dispose();this.copy.material.dispose();this.copy.dispose();}
}
