import {saveRenderState} from './render-state.ts';
import {renderSceneWithGaussians} from './gaussian-layers.ts';
import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
/** Render-target materials output working-linear colors, not canvas sRGB. Decode
 * the finished world, add unexposed display art with shared depth, then encode once. */
export class DisplayComposite {
 private linear=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
 private result=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
 private decode:FullScreenQuad;private encode:FullScreenQuad;
 constructor(private layer:number){
  const vertex='varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}';
  this.decode=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:{color:{value:null},depth:{value:null}},vertexShader:vertex,toneMapped:false,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,
   fragmentShader:'uniform sampler2D color,depth;varying vec2 v;void main(){vec4 c=texture2D(color,v);vec4 s=vec4(c.a>0.000001?c.rgb/c.a:vec3(0.),c.a);gl_FragColor=vec4(sRGBTransferEOTF(s).rgb*c.a,c.a);gl_FragDepth=texture2D(depth,v).r;}'
  }));
  this.encode=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:{color:{value:null}},vertexShader:vertex,toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
   fragmentShader:'uniform sampler2D color;varying vec2 v;void main(){vec4 c=texture2D(color,v);vec4 s=vec4(c.a>0.000001?max(c.rgb/c.a,vec3(0.)):vec3(0.),c.a);gl_FragColor=vec4(sRGBTransferOETF(s).rgb*c.a,c.a);}'
  }));
 }
 render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,color:THREE.WebGLRenderTarget,depth:THREE.DepthTexture,samples:number):THREE.WebGLRenderTarget{
  if(this.linear.width!==color.width||this.linear.height!==color.height){this.linear.setSize(color.width,color.height);this.result.setSize(color.width,color.height);}
  if(this.linear.samples!==samples){this.linear.dispose();this.linear.samples=samples;}
  const restore=saveRenderState(renderer,scene,camera);
  try{
   const u=(this.decode.material as THREE.ShaderMaterial).uniforms;u.color!.value=color.texture;u.depth!.value=depth;
   renderer.setRenderTarget(this.linear);renderer.autoClear=false;renderer.clear();this.decode.render(renderer);
   camera.layers.set(this.layer);scene.background=null;renderSceneWithGaussians(renderer,scene,camera);
   (this.encode.material as THREE.ShaderMaterial).uniforms.color!.value=this.linear.texture;
   renderer.setRenderTarget(this.result);renderer.clear();this.encode.render(renderer);return this.result;
  }finally{restore();}
 }
 dispose():void{this.linear.dispose();this.result.dispose();for(const q of [this.decode,this.encode]){q.material.dispose();q.dispose();}}
}
