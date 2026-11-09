import {saveRenderState} from './render-state.ts';
import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {QualityRenderer,type QualityStatus} from './quality-renderer.ts';
import type {QualitySettings} from '../../studio/quality.ts';
import type {FocusBand,PostSettings} from '../../studio/post-effects.ts';
import type {SplitPanel} from '../../contracts/domain.ts';
/** One canvas/context and shared scene assets. Each half owns its effects/depth.
 * Exposure is measured once by the caller and shared across both views. */
export class SplitRenderer {
 private targets:THREE.WebGLRenderTarget[]=[];private effects:QualityRenderer[]=[];
 private cameras=[new THREE.PerspectiveCamera(),new THREE.PerspectiveCamera()];
 private composite?:FullScreenQuad;private supportedSamples?:number[];
 constructor(private renderer:THREE.WebGLRenderer){}
 get supported():boolean{return this.renderer.extensions.has('EXT_color_buffer_float');}
 render(scene:THREE.Scene,panels:readonly [SplitPanel,SplitPanel],quality:QualitySettings,post:PostSettings,source:string,prepare:(panel:SplitPanel,camera:THREE.PerspectiveCamera)=>FocusBand):{qualityStatus:QualityStatus;msaaSamples:number;shadowLights:number}{
  const renderer=this.renderer,size=renderer.getDrawingBufferSize(new THREE.Vector2());
  const old=renderer.getRenderTarget(),restore=saveRenderState(renderer,scene);
  if(!this.targets.length){
   this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{depthBuffer:true,stencilBuffer:false,generateMipmaps:false}));
   this.effects=[new QualityRenderer(renderer),new QualityRenderer(renderer)];
   this.composite=new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms:{left:{value:null},right:{value:null},seam:{value:0}},toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
    vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
    // Inputs already contain sRGB output. Do not tone-map or encode a second time.
    fragmentShader:'uniform sampler2D left,right;uniform float seam;varying vec2 v;void main(){if(abs(v.x-.5)<seam){gl_FragColor=vec4(.04,.04,.04,1.);return;}gl_FragColor=v.x<.5?texture2D(left,vec2(v.x*2.,v.y)):texture2D(right,vec2((v.x-.5)*2.,v.y));}'
   }));
  }
  try{
   if(!this.supportedSamples){const gl=renderer.getContext() as WebGL2RenderingContext;const color=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA8,gl.SAMPLES) as Int32Array);const depth=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,gl.SAMPLES) as Int32Array);this.supportedSamples=color.filter(v=>depth.includes(v)).sort((a,b)=>a-b);}
   const samples=quality.msaa===0?0:this.supportedSamples.find(n=>n>=quality.msaa&&n<=renderer.capabilities.maxSamples)??this.supportedSamples.at(-1)??0;
   for(let i=0;i<2;i++){
    const width=i===0?Math.floor(size.x/2):size.x-Math.floor(size.x/2),target=this.targets[i]!,camera=this.cameras[i]!;
    if(target.width!==width||target.height!==size.y)target.setSize(Math.max(1,width),Math.max(1,size.y));
    if(target.samples!==samples){target.dispose();target.samples=samples;}
    camera.aspect=width/size.y;camera.layers.enable(1);
    const focus=prepare(panels[i]!,camera);camera.updateProjectionMatrix();
    renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.autoClear=true;renderer.clear();
    this.effects[i]!.render(scene,camera,quality,source,post,focus,true);
   }
   renderer.setRenderTarget(old);renderer.setScissorTest(false);renderer.autoClear=false;renderer.clear();
   const uniforms=(this.composite!.material as THREE.ShaderMaterial).uniforms;uniforms.left!.value=this.targets[0]!.texture;uniforms.right!.value=this.targets[1]!.texture;uniforms.seam!.value=1/Math.max(1,size.x);this.composite!.render(renderer);
   return {qualityStatus:this.effects.find(e=>e.status!=='EFFECTS')?.status??'EFFECTS',msaaSamples:Math.min(...this.effects.map(e=>e.msaaSamples)),shadowLights:Math.max(...this.effects.map(e=>e.shadowLights))};
  }finally{restore();}
 }
 dispose():void{for(const effect of this.effects)effect.dispose();for(const target of this.targets)target.dispose();if(this.composite){this.composite.material.dispose();this.composite.dispose();this.composite=undefined;}this.targets=[];this.effects=[];}
}
