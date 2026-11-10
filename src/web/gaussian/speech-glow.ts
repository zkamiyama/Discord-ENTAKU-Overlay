import * as THREE from 'three';
import type {SparkRenderer, SplatMesh} from '@sparkjsdev/spark';
import {prepareGaussianColor} from './color-space.ts';

/** Speech uniforms are instance-local, not part of shared PackedSplats.
 * Updating speech must not regenerate the asset, LoD tree or accumulator.
 */
const speech = new WeakMap<SplatMesh, {strength:number;scale:number}>();
export const MAX_GAUSSIAN_SPEAKERS = 32;
export function setGaussianSpeechGlow(mesh:SplatMesh,strength:number,scale=4):void {
 const value=Number.isFinite(strength)?THREE.MathUtils.clamp(strength,0,1):0;
 if(value<=.001){speech.delete(mesh);return;}
 speech.set(mesh,{strength:value,scale:Number.isFinite(scale)?THREE.MathUtils.clamp(scale,1,8):4});
}
export function clearGaussianSpeechGlow(mesh:SplatMesh):void {speech.delete(mesh);}

/** Read the DISPLAYED accumulator, after Spark's onBeforeRender may swap it.
 * In split mode this is the active view, NOT the sole scene draw node's view.
 */
export function fillGaussianSpeechRanges(mapping:SparkRenderer['display']['mapping'],ranges:THREE.Vector4[]):number {
 for(const range of ranges)range.set(0,0,0,0);
 let count=0;
 for(const record of mapping){
  const state=speech.get(record.node as SplatMesh);
  if(!state||record.count<=0)continue;
  let visible=true;
  for(let parent:THREE.Object3D|null=record.node;parent;parent=parent.parent){if(!parent.visible){visible=false;break;}}
  if(!visible)continue;
  if(count>=ranges.length)throw new Error('GAUSSIAN_SPEECH_RANGE_OVERFLOW');
  ranges[count++]!.set(record.base,record.base+record.count,state.strength,state.scale/4);
 }
 return count;
}

/** Spark 2.4.0 adapter: original falloff, sorting and depth test are retained.
 * Isotropic/needle-shaped splats get no inferred-normal rim. The existing ring
 * remains an independent speaking indicator for such assets. No mesh expansion,
 * full-screen blur, additional sorters or render targets are required.
 */
export function installGaussianSpeechGlow(spark:SparkRenderer,activeView:()=>SparkRenderer=()=>spark) {
 const m=spark.material;
 const vertex=m.vertexShader,fragment=m.fragmentShader,originalBefore=spark.onBeforeRender;
 if(spark.covSplats)throw new Error('GAUSSIAN_SPEECH_REQUIRES_SCALE_QUATERNION_ENCODING');
 const u={
  rimMode:{value:2},speakerCount:{value:0},rimPower:{value:2.6},rimIntensity:{value:2.0},haloPixels:{value:5},haloOpacity:{value:0.035},haloIntensity:{value:2.0},
  rimTint:{value:new THREE.Color().setRGB(.04,1,.22)},
  speakerRanges:{value:Array.from({length:MAX_GAUSSIAN_SPEAKERS},()=>new THREE.Vector4())},
 };
 Object.assign(m.uniforms,u);prepareGaussianColor(m);
 const replace=(src:string,needle:string,value:string)=>{
  if(src.split(needle).length!==2)throw new Error('SPARK_2_4_SHADER_HOOK_CHANGED: '+needle.slice(0,70));
  return src.replace(needle,value);
 };
 m.vertexShader=replace(m.vertexShader,'void main() {',`
 uniform int rimMode,speakerCount;
 uniform float rimPower,haloPixels;
 uniform vec4 speakerRanges[32];
 flat out float vRim;
 float speechScale=1.0;
 flat out vec2 vHaloScale;
 void main() {
  vRim=0.0;vHaloScale=vec2(1.0);
 `);
 m.vertexShader=replace(m.vertexShader,'vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);',`
 vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);
 if(rimMode>0&&speakerCount>0){
  float speech=0.0;
  for(int owner=0;owner<32;owner++){
   if(owner>=speakerCount)break;
   vec4 range=speakerRanges[owner];
   if(float(splatIndex)>=range.x&&float(splatIndex)<range.y){speech=range.z;speechScale=range.w;break;}
  }
  if(speech>0.0){
  float lo=min(scales.x,min(scales.y,scales.z));
  float hi=max(scales.x,max(scales.y,scales.z));
  float mid=scales.x+scales.y+scales.z-lo-hi;
  float confidence=1.0-smoothstep(.2,.65,lo/max(mid,1e-7));
  vec3 axis=scales.x<=scales.y&&scales.x<=scales.z?vec3(1,0,0):scales.y<=scales.z?vec3(0,1,0):vec3(0,0,1);
  vec3 n=normalize(quatVec(viewQuaternion,axis));
  vec3 v=isOrthographic?vec3(0,0,1):normalize(-viewCenter);
  vRim=speech*confidence*pow(clamp(1.0-abs(dot(n,v)),0.0,1.0),rimPower);
  }
 }
 `);
 m.vertexShader=replace(m.vertexShader,'vec2 pixelOffset = position.x * eigenVec1 * scale1 + position.y * eigenVec2 * scale2;',`
 // Expand raster support only. Original Gaussian uv/alpha must not be rescaled.
 // Both expansions are screen pixels; thin projected splats have separate ratios.
 float haloPad=(rimMode==2&&vRim>.0001)?haloPixels*speechScale:0.0;
 vHaloScale=vec2(1.0+haloPad/max(scale1,1e-4),1.0+haloPad/max(scale2,1e-4));
 vSplatUv=position.xy*adjustedStdDev*vHaloScale;
 vec2 pixelOffset = position.x * eigenVec1 * (scale1+haloPad) + position.y * eigenVec2 * (scale2+haloPad);
 `);
 m.fragmentShader=replace(m.fragmentShader,'void main() {',`
 uniform int rimMode;
 uniform float rimIntensity,haloOpacity,haloIntensity;
 uniform vec3 rimTint;
 flat in float vRim;
 flat in vec2 vHaloScale;
 void main() {
 `);
 m.fragmentShader=replace(m.fragmentShader,'if (z2 > (adjustedStdDev * adjustedStdDev)) {',`
 float haloZ2=dot(vSplatUv/vHaloScale,vSplatUv/vHaloScale);
 if (haloZ2 > (adjustedStdDev * adjustedStdDev)) {
 `);
 // Keep the official falloff (including LoD opacity >1) exactly as published.
 m.fragmentShader=replace(m.fragmentShader,'if (rgba.a < minAlpha) {',`
 if(z2>adjustedStdDev*adjustedStdDev)rgba.a=0.0;
 float originalAlpha=rgba.a;
 float haloA=(rimMode==2)?min(0.12,haloOpacity*vRim*min(vRgba.a,1.0)*exp(-.5*haloZ2)):0.0;
 float finalAlpha=originalAlpha+(1.0-originalAlpha)*haloA;
 if (finalAlpha < minAlpha) {
 `);
 m.fragmentShader=replace(m.fragmentShader,'#ifdef PREMULTIPLIED_ALPHA',`
 // Keep silent splats byte-equivalent to native rendering. Emission is added
 // in linear light on BOTH direct-sRGB and render-target paths.
 if(vRim>0.0){
  vec3 linearRgb=encodeLinear?rgba.rgb:sRGBTransferEOTF(vec4(rgba.rgb,1.0)).rgb;
  vec3 premul=linearRgb*originalAlpha + rimTint*(rimIntensity*vRim*originalAlpha + haloIntensity*(1.0-originalAlpha)*haloA);
  rgba.a=finalAlpha;
  vec3 linearOut=finalAlpha>0.0?premul/finalAlpha:vec3(0.0);
  rgba.rgb=encodeLinear?linearOut:sRGBTransferOETF(vec4(linearOut,1.0)).rgb;
 }
 #ifdef PREMULTIPLIED_ALPHA
 `);
 m.needsUpdate=true;
 const before=function(this:SparkRenderer,...args:Parameters<typeof spark.onBeforeRender>){
  originalBefore.apply(this,args);
  u.speakerCount.value=fillGaussianSpeechRanges(activeView().display.mapping,u.speakerRanges.value);
  this.material.uniformsNeedUpdate=true;
 };
 spark.onBeforeRender=before;
 return {uniforms:u,setMode(mode:0|1|2){u.rimMode.value=mode;},dispose(){
  if(spark.onBeforeRender===before)spark.onBeforeRender=originalBefore;
  m.vertexShader=vertex;m.fragmentShader=fragment;
  for(const key of Object.keys(u))delete m.uniforms[key];
  m.needsUpdate=true;
 }};
}
