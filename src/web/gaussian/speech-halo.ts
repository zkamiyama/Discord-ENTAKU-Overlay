import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {saveRenderState} from '../studio/render-state.ts';
import {GAUSSIAN_COLOR_LAYER} from '../studio/gaussian-layers.ts';
import {MAX_GAUSSIAN_HALO_RADIUS} from './speech-screen.ts';

const vertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
// RGBA8 stores two exact 16-bit texel coordinates, with zero reserved for no
// seed. No float render-target extension or CPU/GPU readback is required.
const coordinates=`
 vec4 packSeed(vec2 p){vec2 n=floor(p)+1.0;return vec4(mod(n.x,256.0),floor(n.x/256.0),mod(n.y,256.0),floor(n.y/256.0))/255.0;}
 vec2 unpackSeed(vec4 value){vec4 n=floor(value*255.0+0.5);return vec2(n.x+256.0*n.y,n.z+256.0*n.w)-1.0;}
 bool validSeed(vec2 p){return p.x>=0.0&&p.y>=0.0;}
`;
function dataTarget(depthBuffer=false):THREE.WebGLRenderTarget {
 const target=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer,stencilBuffer:false});
 if(depthBuffer)target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
 return target;
}

/** Native-footprint mask followed by a bounded screen-space distance field.
 * Each seed retains its own strength/radius/depth. Work depends on pixels and
 * log2(radius), never on splat count times the expanded footprint area.
 * Equal-size camera views reuse the same targets through GaussianSpeechHaloPool.
 */
export class GaussianSpeechHalo {
 readonly mask=dataTarget(true);
 private readonly a=dataTarget();
 private readonly b=dataTarget();
 private readonly size=new THREE.Vector2(1,1);
 private readonly fieldSize=new THREE.Vector2(1,1);
 private readonly seed:FullScreenQuad;
 private readonly spread:FullScreenQuad;
 readonly composite:THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
 private readonly materials=new Map<THREE.Material,boolean>();
 constructor(){
  this.mask.texture.name='Gaussian speech native mask';
  const shader=(fragmentShader:string,uniforms:Record<string,THREE.IUniform>)=>new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending});
  this.seed=new FullScreenQuad(shader(`uniform sampler2D mask;uniform vec2 size,fieldSize;varying vec2 vUv;${coordinates}
   void main(){
    vec2 start=floor(floor(vUv*fieldSize)*size/fieldSize),winner=vec2(-1.0);float best=0.003;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
     vec2 p=min(size-1.0,start+vec2(float(x),float(y)));float strength=texture2D(mask,(p+0.5)/size).r;
     if(strength>best){best=strength;winner=p;}
    }
    gl_FragColor=validSeed(winner)?packSeed(winner):vec4(0.0);
   }`,{mask:{value:this.mask.texture},size:{value:this.size},fieldSize:{value:this.fieldSize}}));
  this.spread=new FullScreenQuad(shader(`uniform sampler2D seeds,mask;uniform vec2 size,fieldSize;uniform float stepSize;varying vec2 vUv;${coordinates}
   void main(){
    vec2 cell=floor(vUv*fieldSize),p=(cell+0.5)*size/fieldSize-0.5,winner=vec2(-1.0);float best=0.0;
    vec2 own=floor(p);if(texture2D(mask,(own+0.5)/size).r>=1.0){gl_FragColor=packSeed(own);return;}
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
     vec2 probe=cell+vec2(float(x),float(y))*stepSize;
     if(any(lessThan(probe,vec2(0.0)))||any(greaterThanEqual(probe,fieldSize)))continue;
     vec2 origin=unpackSeed(texture2D(seeds,(probe+0.5)/fieldSize));
     if(!validSeed(origin))continue;
     vec4 source=texture2D(mask,(origin+0.5)/size);
     float radius=min(${MAX_GAUSSIAN_HALO_RADIUS.toFixed(1)},${MAX_GAUSSIAN_HALO_RADIUS.toFixed(1)}*source.g/max(source.r,1.0/255.0));
     float distanceToSource=length(origin-p);
     float score=source.r*(1.0-smoothstep(0.0,max(radius,0.5),distanceToSource));
     if(score>best){best=score;winner=origin;}
    }
    gl_FragColor=validSeed(winner)?packSeed(winner):vec4(0.0);
   }`,{seeds:{value:null},mask:{value:this.mask.texture},size:{value:this.size},fieldSize:{value:this.fieldSize},stepSize:{value:1}}));
  const material=shader(`uniform sampler2D seeds,mask,depth;uniform vec2 size;uniform vec3 tint;uniform bool encodeLinear;varying vec2 vUv;${coordinates}
   void main(){
    vec2 p=floor(vUv*size),origin=unpackSeed(texture2D(seeds,(p+0.5)/size));if(!validSeed(origin))discard;
    vec2 sourceUv=(origin+0.5)/size;vec4 source=texture2D(mask,sourceUv);
    float radius=min(${MAX_GAUSSIAN_HALO_RADIUS.toFixed(1)},${MAX_GAUSSIAN_HALO_RADIUS.toFixed(1)}*source.g/max(source.r,1.0/255.0));
    float alpha=0.35*source.r*(1.0-smoothstep(0.0,max(radius,0.5),length(origin-p)));
    if(alpha<0.001)discard;
    vec3 color=encodeLinear?tint:sRGBTransferOETF(vec4(tint,1.0)).rgb;
    gl_FragColor=vec4(color*alpha,alpha);gl_FragDepth=texture2D(depth,sourceUv).r;
   }`,{seeds:{value:null},mask:{value:this.mask.texture},depth:{value:this.mask.depthTexture},size:{value:this.size},tint:{value:new THREE.Color(.04,1,.22)},encodeLinear:{value:true}});
  material.transparent=true;material.premultipliedAlpha=true;material.blending=THREE.NormalBlending;material.depthTest=true;
  this.composite=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  this.composite.name='Gaussian speech silhouette';this.composite.frustumCulled=false;this.composite.renderOrder=-Infinity;
  this.composite.layers.set(1);this.composite.layers.enable(GAUSSIAN_COLOR_LAYER);this.composite.visible=false;
 }
 setSize(width:number,height:number):void {
  if(width===this.size.x&&height===this.size.y)return;
  this.size.set(width,height);this.mask.setSize(width,height);
  // Keep native coverage/depth at full resolution. Only the distance field is
  // half resolution, and final distance is evaluated in actual target pixels.
  this.fieldSize.set(Math.ceil(width/2),Math.ceil(height/2));
  for(const target of [this.a,this.b])target.setSize(this.fieldSize.x,this.fieldSize.y);
 }
 /** Preserve actual alpha-test, skinning and imported material depth semantics.
  * Unlike an override depth material, colorWrite does not replace their shader.
  */
 prepareDepth(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,source:THREE.WebGLRenderTarget|null):void {
  renderer.setRenderTarget(this.mask);renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.clear();
  if(source?.depthTexture&&source.depthTexture.type===this.mask.depthTexture!.type){
   renderer.copyTextureToTexture(source.depthTexture,this.mask.depthTexture!);
   // copyTextureToTexture restores its own framebuffer bindings, not a target.
   renderer.setRenderTarget(this.mask);return;
  }
  const cameraMask=camera.layers.mask,background=scene.background,override=scene.overrideMaterial;
  try{
   camera.layers.set(0);camera.layers.enable(2);scene.background=null;
   scene.traverseVisible(object=>{
    const mesh=object as THREE.Mesh;if(!mesh.material)return;
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
     if(!this.materials.has(material)){this.materials.set(material,material.colorWrite);material.colorWrite=false;}
    }
   });
   if(override&&!this.materials.has(override)){this.materials.set(override,override.colorWrite);override.colorWrite=false;}
   renderer.render(scene,camera);
  }finally{
   for(const [material,colorWrite] of this.materials)material.colorWrite=colorWrite;this.materials.clear();
   camera.layers.mask=cameraMask;scene.background=background;
  }
 }
 spreadMask(renderer:THREE.WebGLRenderer,maximumRadius:number):void {
  renderer.setRenderTarget(this.a);this.seed.render(renderer);
  let input=this.a,output=this.b;
  const material=this.spread.material as THREE.ShaderMaterial;
  const fieldRadius=Math.min(MAX_GAUSSIAN_HALO_RADIUS,maximumRadius)*Math.max(this.fieldSize.x/this.size.x,this.fieldSize.y/this.size.y);
  // A one-cell final step preserves a contiguous edge at every glow setting.
  for(let step=2**Math.floor(Math.log2(Math.max(1,fieldRadius)));step>=1;step/=2){
   material.uniforms.seeds!.value=input.texture;material.uniforms.stepSize!.value=step;
   renderer.setRenderTarget(output);this.spread.render(renderer);[input,output]=[output,input];
  }
  this.composite.material.uniforms.seeds!.value=input.texture;
 }
 prepare(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,renderMask:()=>number,tint:THREE.Color):void {
  const source=renderer.getRenderTarget(),restore=saveRenderState(renderer,scene,camera);
  this.composite.visible=false;
  try{
   renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;
   this.prepareDepth(renderer,scene,camera,source);
   scene.background=null;camera.layers.set(GAUSSIAN_COLOR_LAYER);
   const maximumRadius=renderMask();
   if(maximumRadius<=0)return;
   this.spreadMask(renderer,maximumRadius);
   this.composite.material.uniforms.tint!.value.copy(tint);
   this.composite.material.uniforms.encodeLinear!.value=source!==null||renderer.outputColorSpace!==THREE.SRGBColorSpace;
   this.composite.visible=maximumRadius>0;
  }finally{restore();}
 }
 dispose():void {
  this.composite.removeFromParent();this.composite.geometry.dispose();this.composite.material.dispose();
  for(const quad of [this.seed,this.spread]){quad.material.dispose();quad.dispose();}
  for(const target of [this.mask,this.a,this.b])target.dispose();
 }
}

/** An odd-width split has two adjacent pixel widths. Keep both complete target
 * sets rather than disposing/reallocating every panel, bounded to two sizes. */
export class GaussianSpeechHaloPool {
 private readonly entries=new Map<string,GaussianSpeechHalo>();
 constructor(private readonly scene:THREE.Scene){}
 get size():number{return this.entries.size;}
 acquire(width:number,height:number):GaussianSpeechHalo {
  this.hide();
  const key=width+'x'+height,existing=this.entries.get(key);
  if(existing){this.entries.delete(key);this.entries.set(key,existing);return existing;}
  if(this.entries.size===2){
   const [oldest,halo]=this.entries.entries().next().value!;
   this.entries.delete(oldest);halo.dispose();
  }
  const halo=new GaussianSpeechHalo();halo.setSize(width,height);
  this.scene.add(halo.composite);this.entries.set(key,halo);return halo;
 }
 hide():void {for(const halo of this.entries.values())halo.composite.visible=false;}
 dispose():void {for(const halo of this.entries.values())halo.dispose();this.entries.clear();}
}
