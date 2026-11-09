import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {PoissonDenoiseShader} from 'three/addons/shaders/PoissonDenoiseShader.js';
import type {QualitySettings} from '../../studio/quality.ts';

// WebGLRenderer has no SSGI addon in pinned r187. Reuse Three's reconstruction
// and Poisson denoiser; only the bounded, single-bounce diffuse trace is local.
// No temporal history: a CUT cannot leave illumination from the previous shot.
const start=PoissonDenoiseShader.fragmentShader.indexOf('vec3 getViewPosition');
const end=PoissonDenoiseShader.fragmentShader.indexOf('void denoiseSample');
if(start<0||end<=start)throw new Error('THREE_DEPTH_HELPERS_CHANGED');
const helpers=PoissonDenoiseShader.fragmentShader.slice(start,end);
const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const declarations=`
 varying vec2 vUv;uniform sampler2D tDepth,tNormal;
 uniform mat4 cameraProjectionMatrixInverse;
 #include <common>
 #include <packing>
 ${helpers}
`;
const traceShader=`${declarations}
 uniform sampler2D tDiffuse,tAlbedo;uniform mat4 projection;
 uniform float radius,exposure;uniform vec2 resolution;
 void main(){
  gl_FragColor=vec4(0.);
  float depth=getDepth(vUv);vec2 texel=1./vec2(textureSize(tDepth,0));
  if(depth>=.9999999||any(lessThan(vUv,texel*3.))||any(greaterThan(vUv,1.-texel*3.)))return;
  vec3 p=getViewPosition(vUv,depth),n=getViewNormal(vUv);
  if(dot(n,n)<.5)return;
  vec3 albedo=texture2D(tAlbedo,vUv).rgb;if(dot(albedo,albedo)<.00001)return;
  vec3 tangent=normalize(cross(abs(n.z)<.95?vec3(0.,0.,1.):vec3(0.,1.,0.),n)),bitangent=cross(n,tangent);
  float rotation=fract(sin(dot(floor(vUv*resolution),vec2(12.9898,78.233)))*43758.5453)*6.2831853;
  vec3 sum=vec3(0.);float bias=max(.012,radius*.008);
  for(int rayIndex=0;rayIndex<8;rayIndex++){
   float r=sqrt((float(rayIndex)+.5)/8.),angle=float(rayIndex)*2.3999632+rotation;
   vec3 direction=tangent*(r*cos(angle))+bitangent*(r*sin(angle))+n*sqrt(1.-r*r);
   float previousGap=-bias;
   for(int stepIndex=1;stepIndex<=16;stepIndex++){
    float t=float(stepIndex)/16.,distance=radius*t*t;
    vec3 point=p+n*bias+direction*distance;vec4 clip=projection*vec4(point,1.);
    if(clip.w<=0.)break;vec2 uv=clip.xy/clip.w*.5+.5;
    if(any(lessThan(uv,texel*3.))||any(greaterThan(uv,1.-texel*3.)))break;
    float d=getDepth(uv);if(d>=.9999999){previousGap=-bias;continue;}
    vec3 surface=getViewPosition(uv,d);float gap=surface.z-point.z;
    if(previousGap<0.&&gap>=0.&&gap<max(.06,radius*.10)&&distance>bias*2.){
     vec3 hitNormal=getViewNormal(uv);
     if(dot(hitNormal,-direction)>.05){
      // The visible radiance is a one-bounce source, never last frame's GI.
      // Limit extreme emissive samples without tying the effect to 0..1 HDR.
      vec3 incoming=texture2D(tDiffuse,uv).rgb;
      float peak=max(max(incoming.r,incoming.g),incoming.b);
      incoming*=min(1.,16./max(peak*exposure,.00001));
      float edge=smoothstep(0.,.06,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
      sum+=incoming*edge*(1.-smoothstep(radius*.8,radius,distance));
     }
     break;
    }
    previousGap=gap;
   }
  }
  gl_FragColor=vec4(albedo*sum/8.,1.);
 }
`;
const compositeShader=`${declarations}
 uniform sampler2D base,indirect;uniform vec2 giSize;uniform float strength;
 void main(){
  vec4 b=texture2D(base,vUv);gl_FragColor=b;
  float d=getDepth(vUv);if(d>=.9999999||b.a<=0.)return;
  vec3 p=getViewPosition(vUv,d),n=getViewNormal(vUv);
  vec2 position=vUv*giSize-.5,cell=floor(position),f=fract(position);vec3 gi=vec3(0.);float total=0.;
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
   vec2 uv=(cell+vec2(float(x),float(y))+.5)/giSize;
   float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
   vec3 other=getViewPosition(uv,getDepth(uv));
   weight*=max(0.,1.-abs(dot(other-p,n))/.06);
   gi+=texture2D(indirect,uv).rgb*weight;total+=weight;
  }
  if(total>0.)gl_FragColor.rgb+=gi/total*strength*b.a;
 }
`;
export class SSGIPass {
 private albedo=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
 private raw=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
 private filtered=this.raw.clone();
 private cache=new Map<THREE.Material,THREE.MeshBasicMaterial>();
 private black=new THREE.MeshBasicMaterial({color:0});
 private noise:THREE.DataTexture;
 private trace:FullScreenQuad;private denoise:FullScreenQuad;private composite:FullScreenQuad;
 private width=0;private height=0;
 constructor(){
  const bytes=new Uint8Array(8*8*4);for(let i=0;i<bytes.length;i++)bytes[i]=(i*73+41)%256;
  this.noise=new THREE.DataTexture(bytes,8,8);this.noise.wrapS=this.noise.wrapT=THREE.RepeatWrapping;this.noise.needsUpdate=true;
  const material=(uniforms:Record<string,THREE.IUniform>,fragmentShader:string)=>new THREE.ShaderMaterial({uniforms,defines:{NORMAL_VECTOR_TYPE:0},vertexShader,fragmentShader,toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending});
  this.trace=new FullScreenQuad(material({tDepth:{value:null},tNormal:{value:null},tDiffuse:{value:null},tAlbedo:{value:null},cameraProjectionMatrixInverse:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4()},resolution:{value:new THREE.Vector2()},radius:{value:1.5},exposure:{value:1}},traceShader));
  const shader=PoissonDenoiseShader;
  this.denoise=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:THREE.UniformsUtils.clone(shader.uniforms),defines:{...shader.defines,NORMAL_VECTOR_TYPE:0},vertexShader:shader.vertexShader,fragmentShader:shader.fragmentShader,toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending}));
  this.composite=new FullScreenQuad(material({tDepth:{value:null},tNormal:{value:null},base:{value:null},indirect:{value:null},cameraProjectionMatrixInverse:{value:new THREE.Matrix4()},giSize:{value:new THREE.Vector2()},strength:{value:.6}},compositeShader));
 }
 private diffuse(material:THREE.Material):THREE.Material {
  // Unlit artwork/emissive surfaces receive no extra diffuse bounce.
  if(!(material instanceof THREE.MeshStandardMaterial))return this.black;
  let result=this.cache.get(material);
  if(!result){result=new THREE.MeshBasicMaterial({color:material.color,map:material.map,alphaMap:material.alphaMap,alphaTest:material.alphaTest,side:material.side,vertexColors:material.vertexColors,transparent:material.transparent,opacity:material.opacity});this.cache.set(material,result);}
  result.color.copy(material.color).multiplyScalar(1-material.metalness);return result;
 }
 render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,input:THREE.WebGLRenderTarget,depth:THREE.DepthTexture,output:THREE.WebGLRenderTarget,q:QualitySettings):void {
  const w=Math.max(1,Math.round(input.width*q.effectsScale)),h=Math.max(1,Math.round(input.height*q.effectsScale));
  if(w!==this.width||h!==this.height){this.width=w;this.height=h;this.raw.setSize(w,h);this.filtered.setSize(w,h);this.albedo.setSize(input.width,input.height);}
  const saved:Array<[THREE.Mesh,THREE.Material|THREE.Material[]]>=[],background=scene.background,override=scene.overrideMaterial;
  try{
   scene.background=null;scene.overrideMaterial=null;
   scene.traverseVisible(object=>{if(object instanceof THREE.Mesh&&object.layers.test(camera.layers)){
    saved.push([object,object.material]);object.material=Array.isArray(object.material)?object.material.map(m=>this.diffuse(m)):this.diffuse(object.material);
   }});
   renderer.setRenderTarget(this.albedo);renderer.clear();renderer.render(scene,camera);
  }finally{for(const [object,material]of saved)object.material=material;scene.background=background;scene.overrideMaterial=override;}
  const u=(this.trace.material as THREE.ShaderMaterial).uniforms;
  u.tDepth!.value=depth;u.tDiffuse!.value=input.texture;u.tAlbedo!.value=this.albedo.texture;
  u.cameraProjectionMatrixInverse!.value.copy(camera.projectionMatrixInverse);u.projection!.value.copy(camera.projectionMatrix);u.resolution!.value.set(w,h);u.radius!.value=q.giRadius;u.exposure!.value=renderer.toneMappingExposure;
  renderer.setRenderTarget(this.raw);renderer.clear();this.trace.render(renderer);
  const d=(this.denoise.material as THREE.ShaderMaterial).uniforms;
  d.tDiffuse!.value=this.raw.texture;d.tDepth!.value=depth;d.tNoise!.value=this.noise;d.resolution!.value.set(w,h);d.cameraProjectionMatrixInverse!.value.copy(camera.projectionMatrixInverse);
  d.lumaPhi!.value=16/Math.max(renderer.toneMappingExposure,.00001);d.depthPhi!.value=.06;d.normalPhi!.value=16;d.radius!.value=3;
  renderer.setRenderTarget(this.filtered);renderer.clear();this.denoise.render(renderer);
  const c=(this.composite.material as THREE.ShaderMaterial).uniforms;
  c.tDepth!.value=depth;c.base!.value=input.texture;c.indirect!.value=this.filtered.texture;c.giSize!.value.set(w,h);c.strength!.value=q.giStrength;c.cameraProjectionMatrixInverse!.value.copy(camera.projectionMatrixInverse);
  renderer.setRenderTarget(output);renderer.clear();this.composite.render(renderer);
  // Remove stale material copies after a studio/model replacement.
  const alive=new Set(saved.flatMap(([,m])=>Array.isArray(m)?m:[m]));
  for(const [material,copy]of this.cache)if(!alive.has(material)){copy.dispose();this.cache.delete(material);}
 }
 dispose():void {
  for(const target of [this.albedo,this.raw,this.filtered])target.dispose();
  for(const quad of [this.trace,this.denoise,this.composite]){quad.material.dispose();quad.dispose();}
  for(const material of this.cache.values())material.dispose();this.cache.clear();this.black.dispose();this.noise.dispose();
 }
}
