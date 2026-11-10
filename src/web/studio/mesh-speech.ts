import * as THREE from 'three';
import {projectedObjectHeightPixels,speechScreenGlowRadius} from '../gaussian/speech-screen.ts';

/** Glow is a display-layer, view-dependent INVERTED HULL, not a world-space
 * scaled duplicate. Three's original GLTF materials and geometries stay live;
 * outline shells borrow them and never cast shadows or enter SSR normal passes.
 *
 * The standard MeshBasic shader handles morph/skin/instancing. We patch only
 * projected vertex positions and use real framebuffer pixels, so the halo width
 * changes with zoom, SPLIT, resolution, and speechGlowScale exactly as in 3DGS.
 */
const DISPLAY_LAYER=1;
type Textured=THREE.Material & {map?:THREE.Texture|null;alphaMap?:THREE.Texture|null;alphaTest?:number};
interface Hull {
 source:THREE.Mesh;
 object:THREE.Mesh;
 material:THREE.MeshBasicMaterial;
 radius:THREE.IUniform<number>;
 resolution:THREE.IUniform<THREE.Vector2>;
 factor:number;
 opacity:number;
}
export class MeshSpeechGlow {
 private hulls:Hull[]=[];
 private ownedGeometries=new Set<THREE.BufferGeometry>();
 private originals=new Map<THREE.Material,{opacity:number;transparent:boolean;depthWrite:boolean}>();
 private readonly bounds:THREE.Box3;
 private level=0;
 private scale=4;
 private disposed=false;
 private drawSize=new THREE.Vector2();
 private lastCamera?:THREE.Camera;
 private lastSize=new THREE.Vector2(-1,-1);
 private lastCameraMatrix=new THREE.Matrix4();
 private lastObjectMatrix=new THREE.Matrix4();
 private lastScale=NaN;
 private lastRadius=0;
 constructor(readonly object:THREE.Object3D,readonly speakerUserId:string){
  if(!/^\d{1,20}$/.test(speakerUserId))throw new Error('MESH_SPEAKER_ID_INVALID');
  object.updateWorldMatrix(true,true);
  this.bounds=new THREE.Box3().setFromObject(object,true).applyMatrix4(object.matrixWorld.clone().invert());
  if(this.bounds.isEmpty()||![...this.bounds.min.toArray(),...this.bounds.max.toArray()].every(Number.isFinite))throw new Error('MESH_SPEECH_BOUNDS_INVALID');
  const meshes:THREE.Mesh[]=[];
  object.traverse(o=>{if(o instanceof THREE.Mesh&&!o.userData.entakuMeshSpeechOutline)meshes.push(o);});
  if(!meshes.length)throw new Error('MESH_SPEECH_GEOMETRY_MISSING');
  try{
   for(const mesh of meshes){
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      if(!this.originals.has(material))this.originals.set(material,{opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite});
    }
    // A GLTF may omit normals. Never mutate the imported shared geometry:
    // only the outline uses this optional clone, and owns its lifecycle.
    const geometry=mesh.geometry.getAttribute('normal')?mesh.geometry:mesh.geometry.clone();
    if(geometry!==mesh.geometry){geometry.computeVertexNormals();this.ownedGeometries.add(geometry);}
    for(const [factor,opacity] of [[1,.10],[.56,.30]] as const) {
     const original=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
     const alpha=(original??new THREE.MeshBasicMaterial()) as Textured;
     const material=new THREE.MeshBasicMaterial({
      color:0xffffff,side:THREE.BackSide,transparent:true,opacity:0,depthTest:true,depthWrite:false,
      toneMapped:false,map:alpha.map??null,alphaMap:alpha.alphaMap??null,alphaTest:alpha.alphaTest??0,
      fog:false
     });
     const radius:THREE.IUniform<number>={value:0},resolution:THREE.IUniform<THREE.Vector2>={value:new THREE.Vector2(1,1)};
     material.onBeforeCompile=shader=>{
      const marker='#include <project_vertex>';
      if(shader.vertexShader.split(marker).length!==2)throw new Error('MESH_SPEECH_VERTEX_HOOK_CHANGED');
      shader.uniforms.entakuGlowRadius=radius;shader.uniforms.entakuGlowSize=resolution;
      shader.vertexShader='uniform float entakuGlowRadius;\nuniform vec2 entakuGlowSize;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace(marker,`
#if !defined(USE_ENVMAP) && !defined(USE_SKINNING)
 #include <beginnormal_vertex>
 #include <morphnormal_vertex>
 #include <skinbase_vertex>
 #include <skinnormal_vertex>
 #include <defaultnormal_vertex>
#endif
${marker}
vec2 outward=-transformedNormal.xy;
float nlen=length(outward);
if(nlen>0.0001)gl_Position.xy+=outward/nlen * vec2(2.0*entakuGlowRadius)/entakuGlowSize * gl_Position.w;
`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 diffuseColor.rgb=vec3(.06,1.0,.21);
`);
     };
     material.customProgramCacheKey=()=> 'entaku-mesh-speech-v1';
     let shell:THREE.Mesh;
     if(mesh instanceof THREE.SkinnedMesh){
      const skinned=new THREE.SkinnedMesh(geometry,material);
      skinned.bindMode=mesh.bindMode;skinned.bind(mesh.skeleton,mesh.bindMatrix);skinned.bindMatrixInverse.copy(mesh.bindMatrixInverse);
      shell=skinned;
     }else if(mesh instanceof THREE.InstancedMesh){
      const instanced=new THREE.InstancedMesh(geometry,material,mesh.count);
      instanced.instanceMatrix=mesh.instanceMatrix;instanced.instanceColor=mesh.instanceColor;instanced.count=mesh.count;
      shell=instanced;
     }else shell=new THREE.Mesh(geometry,material);
     shell.morphTargetInfluences=mesh.morphTargetInfluences;
     shell.layers.set(DISPLAY_LAYER);
     shell.userData.entakuMeshSpeechOutline=true;
     shell.frustumCulled=false; shell.castShadow=false; shell.receiveShadow=false;
     shell.renderOrder=mesh.renderOrder+1;
     shell.visible=false;
     shell.onBeforeRender=(renderer,_scene,camera)=>{
      if(this.disposed||this.level<=.001)return;
      const target=renderer.getRenderTarget();
      if(target)this.drawSize.set(target.width,target.height);else renderer.getDrawingBufferSize(this.drawSize);
      const size=this.drawSize;
      if(!this.lastCamera||this.lastCamera!==camera||
        size.x!==this.lastSize.x||size.y!==this.lastSize.y||
        !this.lastCameraMatrix.equals(camera.matrixWorld)||
        !this.lastObjectMatrix.equals(this.object.matrixWorld)||this.lastScale!==this.scale){
       const pixels=projectedObjectHeightPixels(this.object,this.bounds,camera,size.y);
       this.lastRadius=speechScreenGlowRadius(pixels,size.y,this.scale);
       this.lastCamera=camera;this.lastCameraMatrix.copy(camera.matrixWorld);
       this.lastObjectMatrix.copy(this.object.matrixWorld);
       this.lastSize.copy(size);this.lastScale=this.scale;
      }
      radius.value=this.lastRadius*factor;resolution.value.copy(size);
     };
     mesh.add(shell);
     this.hulls.push({source:mesh,object:shell,material,radius,resolution,factor,opacity});
    }
   }
  }catch(error){this.dispose();throw error;}
 }
 /** Fade the mesh's original GLTF materials; originals are restored on disposal. */
 setPresence(value:number):void {
  if(this.disposed)return;
  const opacity=Number.isFinite(value)?THREE.MathUtils.clamp(value,0,1):0;
  for(const [material,original] of this.originals){
   material.opacity=original.opacity*opacity;
   const transparent=original.transparent||opacity<.999;
   if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
   material.depthWrite=original.depthWrite&&opacity>=.999;
  }
 }
 setSpeech(intensity:number,glowScale=4):void {
  if(this.disposed)return;
  this.level=Number.isFinite(intensity)?THREE.MathUtils.clamp(intensity,0,1):0;
  this.scale=Number.isFinite(glowScale)?THREE.MathUtils.clamp(glowScale,1,8):4;
  for(const hull of this.hulls){
   hull.object.visible=this.level>.001&&hull.source.visible;
   hull.material.opacity=this.level*hull.opacity;
  }
 }
 get active(){return !this.disposed&&this.level>.001;}
 get hullCount(){return this.hulls.length;}
 dispose():void{
  if(this.disposed)return;this.disposed=true;
  for(const hull of this.hulls){hull.object.removeFromParent();hull.material.dispose();}
  this.hulls=[];
  for(const geometry of this.ownedGeometries)geometry.dispose();this.ownedGeometries.clear();
  for(const [material,original] of this.originals){
   material.opacity=original.opacity;material.transparent=original.transparent;material.depthWrite=original.depthWrite;
   material.needsUpdate=true;
  }
  this.originals.clear();
 }
}
