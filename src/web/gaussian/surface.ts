import * as THREE from 'three';
import {SparkRenderer,type PackedSplats} from '@sparkjsdev/spark';
import {replaceShaderOnce} from '../studio/addon-adapters.ts';
import {saveRenderState} from '../studio/render-state.ts';

/** Geometry-only raster layer. Never enabled by the main color/meter camera. */
export const GAUSSIAN_SURFACE_LAYER=5;
export const DEFAULT_GAUSSIAN_ALPHA_CLIP=.3;
const templates=new WeakMap<THREE.WebGLRenderer,string>();
const geometries=new WeakMap<PackedSplats,{geometry:THREE.InstancedBufferGeometry;references:number}>();
function borrowGeometry(packed:PackedSplats){
 let entry=geometries.get(packed);
 if(!entry){
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
  geometry.setIndex([0,1,2,0,2,3]);geometry.instanceCount=packed.numSplats;
  entry={geometry,references:0};geometries.set(packed,entry);
 }
 entry.references++;const owned=entry;let released=false;
 return {geometry:owned.geometry,release(){if(released)return;released=true;if(--owned.references===0){owned.geometry.dispose();geometries.delete(packed);}}};
}
/** Use the installed Spark projection/encoding, not an independent rasterizer.
 * Public ShaderMaterial source is obtained lazily; the template never renders,
 * allocates a sorter, builds another LoD, or retains the asset's texture.
 */
export function nativeSurfaceVertex(source:string):string {
 const patch=(needle:string,value:string)=>{source=replaceShaderOnce(source,needle,value,'SPARK_SURFACE_SHADER_CHANGED');};
 patch('void main() {',`uniform vec4 sourceEncoding;\nflat out vec3 surfaceNormal;\nvoid main() {\nsurfaceNormal=vec3(0,0,1);`);
 patch('ivec2 orderingCoord = ivec2((gl_InstanceID >> 2) & 4095, gl_InstanceID >> 14);\n    uint splatIndex = texelFetch(ordering, orderingCoord, 0)[gl_InstanceID & 3];','uint splatIndex = uint(gl_InstanceID);');
 patch('unpackSplatEncoding(packedData, center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));','unpackSplatEncoding(packedData, center, scales, quaternion, rgba, sourceEncoding);');
 // Raw PackedSplats opacity is not the half-alpha accumulator encoding.
 patch('rgba.a *= 2.0;','/* original source opacity, not accumulator half-alpha */');
 patch('vec3 viewCenter = (!enableCovSplats ? quatVec(renderToViewQuat, center) : (renderToViewBasis * center)) + renderToViewPos;','vec3 viewCenter = (modelViewMatrix * vec4(center,1.0)).xyz;');
 patch('mat3 RS = scaleQuaternionToMatrix(scales, viewQuaternion);',`mat3 RS = mat3(modelViewMatrix) * scaleQuaternionToMatrix(scales, quaternion);
        float lo=min(scales.x,min(scales.y,scales.z)),hi=max(scales.x,max(scales.y,scales.z));
        float mid=scales.x+scales.y+scales.z-lo-hi;
        vec3 axis=scales.x<=scales.y&&scales.x<=scales.z?vec3(1,0,0):scales.y<=scales.z?vec3(0,1,0):vec3(0,0,1);
        vec3 eye=isOrthographic?vec3(0,0,1):normalize(-viewCenter);
        vec3 n=normalize(normalMatrix * quatVec(quaternion,axis));
        if(dot(n,eye)<0.0)n=-n;
        // A sphere/needle has no stable surface normal: use a facing normal,
        // never normalize a cancellation of opposite, unoriented normals.
        float confidence=1.0-smoothstep(.2,.65,lo/max(mid,1e-7));
        surfaceNormal=normalize(mix(eye,n,confidence));`);
 return source;
}
const fragment=`precision highp float;
 in vec4 vRgba;in vec2 vSplatUv;flat in float adjustedStdDev;flat in vec3 surfaceNormal;
 uniform float alphaClip;uniform int surfaceMode;out vec4 fragColor;
 #include <logdepthbuf_pars_fragment>
 void main(){
  float z2=dot(vSplatUv,vSplatUv);if(z2>adjustedStdDev*adjustedStdDev)discard;
  float a=vRgba.a*exp(-.5*z2);if(a<alphaClip)discard;
  // Normal color has the same encoding as Three MeshNormalMaterial (view space).
  fragColor=surfaceMode==1?vec4(normalize(surfaceNormal)*.5+.5,1.):vec4(0.);
  #include <logdepthbuf_fragment>
 }`;

/** A GPU draw helper, not a fitted/proxy triangle model. Four shared vertices
 * rasterize each original Gaussian's projected ellipse from its packed texture.
 * Z testing chooses the nearest alpha-clipped core; neither light sorting nor
 * a camera-dependent LoD selection can omit offscreen shadow casters.
 */
export class GaussianSurface extends THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial> {
 readonly packed:PackedSplats;
 readonly drawCounts={depth:0,normal:0,shadow:0};
 private readonly releaseGeometry:()=>void;
 private readonly uniforms:ReturnType<typeof SparkRenderer.makeUniforms>&{sourceEncoding:THREE.IUniform;alphaClip:THREE.IUniform<number>;surfaceMode:THREE.IUniform<number>};
 private readonly viewport=new THREE.Vector4();
 private initialized=false;private stopped=false;private pass:'depth'|'normal'='depth';
 constructor(packed:PackedSplats){
  if(packed.splatEncoding.lodOpacity)throw new Error('GAUSSIAN_SURFACE_REQUIRES_ORIGINAL_SPLATS');
  const lease=borrowGeometry(packed),e=packed.splatEncoding;
  const uniforms={...SparkRenderer.makeUniforms(),sourceEncoding:{value:new THREE.Vector4(e.rgbMin,e.rgbMax,e.lnScaleMin,e.lnScaleMax)},alphaClip:{value:DEFAULT_GAUSSIAN_ALPHA_CLIP},surfaceMode:{value:0}};
  uniforms.maxStdDev.value=Math.sqrt(8);uniforms.blurAmount.value=.3;uniforms.clipXY.value=1.4;
  const material=new THREE.ShaderMaterial({uniforms,vertexShader:'void main(){gl_Position=vec4(0,0,2,1);}',fragmentShader:fragment,glslVersion:THREE.GLSL3,
   side:THREE.DoubleSide,blending:THREE.NoBlending,transparent:false,depthTest:true,depthWrite:true,colorWrite:false,toneMapped:false});
  super(lease.geometry,material);this.packed=packed;this.uniforms=uniforms;this.releaseGeometry=lease.release;
  this.name='Gaussian native depth/normal/shadow';this.layers.set(GAUSSIAN_SURFACE_LAYER);
  this.frustumCulled=false;this.castShadow=true;this.receiveShadow=false;
  this.userData.entakuGaussianSurface=true;
  this.customDepthMaterial=material; // r187 PCF samples native DepthTexture, not packed RGBA.
 }
 get alphaClip():number{return this.uniforms.alphaClip.value;}
 set alphaClip(value:number){this.uniforms.alphaClip.value=Number.isFinite(value)?THREE.MathUtils.clamp(value,.01,.99):DEFAULT_GAUSSIAN_ALPHA_CLIP;}
 private prepare(renderer:THREE.WebGLRenderer):void {
  if(this.stopped)return;
  if(!this.initialized){
   let source=templates.get(renderer);
   if(!source){const template=new SparkRenderer({renderer,enableLod:false,lodRaycast:0});try{source=nativeSurfaceVertex(template.material.vertexShader);}finally{template.dispose();}templates.set(renderer,source);}
   this.material.vertexShader=source;this.material.needsUpdate=true;this.initialized=true;
  }
  this.uniforms.extSplats.value=this.packed.getTexture();
  const v=renderer.getCurrentViewport(this.viewport);this.uniforms.renderSize.value.set(Math.max(1,v.z),Math.max(1,v.w));
  this.material.uniformsNeedUpdate=true;
 }
 override onBeforeRender(renderer:THREE.WebGLRenderer):void {
  this.setPass(this.pass);this.prepare(renderer);this.drawCounts[this.pass]++;
 }
 override onBeforeShadow(renderer:THREE.WebGLRenderer):void {
  this.normalMatrix.getNormalMatrix(this.modelViewMatrix);this.prepare(renderer);this.uniforms.surfaceMode.value=0;this.material.colorWrite=false;this.drawCounts.shadow++;
 }
 setPass(mode:'depth'|'normal'):void {this.pass=mode;this.uniforms.surfaceMode.value=mode==='normal'?1:0;this.material.colorWrite=mode==='normal';}
 dispose():void {
  if(this.stopped)return;this.stopped=true;this.removeFromParent();this.material.dispose();this.releaseGeometry();
  // PackedSplats and its GPU texture belong to the cached asset, not this draw.
 }
}
export function renderGaussianSurfaces(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,mode:'depth'|'normal'):void {
 const objects:GaussianSurface[]=[];scene.traverseVisible(o=>{if(o instanceof GaussianSurface)objects.push(o);});
 if(!objects.length)return;
 const restore=saveRenderState(renderer,scene,camera),override=scene.overrideMaterial;
 // Surfaces are never drawn by the ordinary MeshNormal/metalness overrides.
 try{
  camera.layers.set(GAUSSIAN_SURFACE_LAYER);scene.overrideMaterial=null;scene.background=null;renderer.autoClear=false;
  for(const object of objects)object.setPass(mode);
  renderer.render(scene,camera);
 }finally{for(const object of objects)object.setPass('depth');scene.overrideMaterial=override;restore();}
}
export function nativeSurfaceDiagnostics(scene:THREE.Scene){
 let instances=0,sourceSplats=0,visibleInstances=0;const draws={depth:0,normal:0,shadow:0};const assets=new Set<PackedSplats>();
 scene.traverse(o=>{if(o instanceof GaussianSurface){instances++;sourceSplats+=o.packed.numSplats;assets.add(o.packed);for(const key of ['depth','normal','shadow'] as const)draws[key]+=o.drawCounts[key];}});
 scene.traverseVisible(o=>{if(o instanceof GaussianSurface)visibleInstances++;});
 return {instances,visibleInstances,uniqueSources:assets.size,sourceSplats,draws,mode:'nearest-alpha-core',usesOriginalSplats:true,extraSortWorkers:0};
}
