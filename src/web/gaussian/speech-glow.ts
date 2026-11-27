import * as THREE from 'three';
import type {SparkRenderer, SplatMesh} from '@sparkjsdev/spark';
import {prepareGaussianColor} from './color-space.ts';
import {gaussianScreenGlowRadius,gaussianSpeechIntersectsView,clearGaussianSpeechBounds,MAX_GAUSSIAN_HALO_RADIUS} from './speech-screen.ts';
export {setGaussianSpeechBounds} from './speech-screen.ts';

/** Speech uniforms are instance-local, not part of shared PackedSplats.
 * Updating speech must not regenerate the asset, LoD tree or accumulator.
 */
const speech = new WeakMap<SplatMesh, {strength:number;scale:number}>();
const viewFrustum=new THREE.Frustum(),viewProjection=new THREE.Matrix4();
export const MAX_GAUSSIAN_SPEAKERS = 32;
export function setGaussianSpeechGlow(mesh:SplatMesh,strength:number,scale=4):void {
 const value=Number.isFinite(strength)?THREE.MathUtils.clamp(strength,0,1):0;
 if(value<=.001){speech.delete(mesh);return;}
 speech.set(mesh,{strength:value,scale:Number.isFinite(scale)?THREE.MathUtils.clamp(scale,1,8):4});
}
export function clearGaussianSpeechGlow(mesh:SplatMesh):void {speech.delete(mesh);clearGaussianSpeechBounds(mesh);}
/** Only create the background halo draw when a visible SplatMesh is speaking. */
export function hasSpeakingGaussian(scene:THREE.Scene):boolean {
 let active=false;
 scene.traverseVisible(object=>{if(!active&&speech.has(object as SplatMesh))active=true;});
 return active;
}

/** Read the DISPLAYED accumulator, after Spark's onBeforeRender may swap it.
 * In split mode this is the active view, NOT the sole scene draw node's view.
 */
export function fillGaussianSpeechRanges(mapping:SparkRenderer['display']['mapping'],ranges:THREE.Vector4[],camera?:THREE.Camera,framebufferHeight?:number):number {
 for(const range of ranges)range.set(0,0,0,0);
 if(camera){
  viewProjection.copy(camera.projectionMatrix);
  // Keep the possible halo just beyond the screen edge. The calibrated box
  // alone must not cull an offscreen body whose outline is still visible.
  if(framebufferHeight&&framebufferHeight>0){
   const aspect=Math.abs(viewProjection.elements[5]!/viewProjection.elements[0]!)||1;
   const padding=Math.max(8,Math.min(MAX_GAUSSIAN_HALO_RADIUS,framebufferHeight*.13));
   const xScale=1+2*padding/(framebufferHeight*aspect),yScale=1+2*padding/framebufferHeight;
   // Scale complete clip-space rows, including off-axis projection offsets.
   for(const column of [0,4,8,12]){viewProjection.elements[column]!/=xScale;viewProjection.elements[column+1]!/=yScale;}
  }
  viewFrustum.setFromProjectionMatrix(viewProjection.multiply(camera.matrixWorldInverse),camera.coordinateSystem);
 }
 let count=0;
 for(const record of mapping){
  const state=speech.get(record.node as SplatMesh);
  if(!state||record.count<=0)continue;
  if(camera&&!gaussianSpeechIntersectsView(record.node as SplatMesh,viewFrustum))continue;
  let visible=true;
  for(let parent:THREE.Object3D|null=record.node;parent;parent=parent.parent){if(!parent.visible){visible=false;break;}}
  if(!visible)continue;
  if(count>=ranges.length)throw new Error('GAUSSIAN_SPEECH_RANGE_OVERFLOW');
  ranges[count++]!.set(record.base,record.base+record.count,state.strength,gaussianScreenGlowRadius(record.node as SplatMesh,camera,framebufferHeight,state.scale));
 }
 return count;
}

/** Spark 2.4.0 adapter. The normal draw keeps native projected footprints,
 * alpha falloff, sorting and depth. A separate mask uses the SAME displayed
 * accumulator; its screen-space halo never expands individual splat quads.
 * Speech uniforms belong to a view, not to shared PackedSplats or its LoD tree.
 */
export function installGaussianSpeechGlow(spark:SparkRenderer,activeView:()=>SparkRenderer=()=>spark) {
 const m=spark.material;
 const vertex=m.vertexShader,fragment=m.fragmentShader,originalBefore=spark.onBeforeRender;
 if(spark.covSplats)throw new Error('GAUSSIAN_SPEECH_REQUIRES_SCALE_QUATERNION_ENCODING');
 const u={
  rimMode:{value:2},speakerCount:{value:0},speechMaskPass:{value:0},rimPower:{value:2.6},rimIntensity:{value:2.0},
  rimTint:{value:new THREE.Color().setRGB(.04,1,.22)},
  speakerRanges:{value:Array.from({length:MAX_GAUSSIAN_SPEAKERS},()=>new THREE.Vector4())},
 };
 Object.assign(m.uniforms,u);prepareGaussianColor(m);
 const replace=(src:string,needle:string,value:string)=>{
  if(src.split(needle).length!==2)throw new Error('SPARK_2_4_SHADER_HOOK_CHANGED: '+needle.slice(0,70));
  return src.replace(needle,value);
 };
 m.vertexShader=replace(m.vertexShader,'void main() {',`
 uniform int rimMode,speakerCount,speechMaskPass;
 uniform float rimPower;
 uniform vec4 speakerRanges[32];
 flat out float vRim;
 flat out float vSpeech;
 flat out float vSpeechRadius;
 void main() {
  vRim=0.0;vSpeech=0.0;vSpeechRadius=0.0;
 `);
 m.vertexShader=replace(m.vertexShader,'vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);',`
 vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);
 if(rimMode>0&&speakerCount>0){
  for(int owner=0;owner<32;owner++){
   if(owner>=speakerCount)break;
   vec4 range=speakerRanges[owner];
   if(float(splatIndex)>=range.x&&float(splatIndex)<range.y){vSpeech=range.z;vSpeechRadius=range.w;break;}
  }
  if(vSpeech>0.0&&speechMaskPass==0){
   float lo=min(scales.x,min(scales.y,scales.z));
   float hi=max(scales.x,max(scales.y,scales.z));
   float mid=scales.x+scales.y+scales.z-lo-hi;
   float confidence=1.0-smoothstep(.2,.65,lo/max(mid,1e-7));
   vec3 axis=scales.x<=scales.y&&scales.x<=scales.z?vec3(1,0,0):scales.y<=scales.z?vec3(0,1,0):vec3(0,0,1);
   vec3 n=normalize(quatVec(viewQuaternion,axis));
   vec3 v=isOrthographic?vec3(0,0,1):normalize(-viewCenter);
   vRim=vSpeech*confidence*pow(clamp(1.0-abs(dot(n,v)),0.0,1.0),rimPower);
  }
 }
 `);
 m.fragmentShader=replace(m.fragmentShader,'void main() {',`
 uniform int speechMaskPass;
 uniform float rimIntensity;
 uniform vec3 rimTint;
 flat in float vRim;
 flat in float vSpeech;
 flat in float vSpeechRadius;
 void main() {
 `);
 m.fragmentShader=replace(m.fragmentShader,'#ifdef PREMULTIPLIED_ALPHA',`
 if(speechMaskPass==1){
  // Premultiplied emission and its radius. Silent foreground splats still
  // contribute alpha, correctly occluding a speaker that uses the same asset.
  // Use the same pixel bound as the screen-space distance field.
  fragColor=vec4(vSpeech,vSpeech*vSpeechRadius/${MAX_GAUSSIAN_HALO_RADIUS.toFixed(1)},0.0,1.0)*rgba.a;
  #include <logdepthbuf_fragment>
  return;
 }
 if(vRim>0.0){
  vec3 linearRgb=encodeLinear?rgba.rgb:sRGBTransferEOTF(vec4(rgba.rgb,1.0)).rgb;
  vec3 linearOut=linearRgb+rimTint*rimIntensity*vRim;
  rgba.rgb=encodeLinear?linearOut:sRGBTransferOETF(vec4(linearOut,1.0)).rgb;
 }
 #ifdef PREMULTIPLIED_ALPHA
 `);
 m.needsUpdate=true;
 const before=function(this:SparkRenderer,...args:Parameters<typeof spark.onBeforeRender>){
  originalBefore.apply(this,args);
  const view=activeView();
  u.speakerCount.value=fillGaussianSpeechRanges(view.display.mapping,u.speakerRanges.value,args[2],view.renderSize.y);
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
