import * as THREE from 'three';
/** Studio artwork is unexposed, but still receives studio grading/Bloom/DoF.
 * It is independent of the option that excludes avatars from post-processing. */
export const STUDIO_UNLIT_LAYER=2;
export const BLEND_SHADOW_CUTOFF=.5;
const installed=new WeakSet<THREE.Mesh>();
type Textured=THREE.Material&{map?:THREE.Texture|null;alphaMap?:THREE.Texture|null};
function needsCutout(m:Textured):boolean {
 return m.transparent&&m.alphaTest===0&&!m.alphaHash&&!!(m.map||m.alphaMap);
}
/** MASK already works in Three.js. For BLEND, keep smooth beauty transparency
 * and use an alpha-tested silhouette only when writing the PCF shadow map.
 * Native depth/distance materials retain GLTFLoader's maps, UVs and transforms. */
export function installStudioAlphaShadows(mesh:THREE.Mesh):void {
 if(installed.has(mesh)||mesh.customDepthMaterial||mesh.customDistanceMaterial)return;
 const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]) as Textured[];
 if(!materials.some(needsCutout))return;
 installed.add(mesh);
 // Unique materials avoid leaking opacity/defines into another mesh's shadow.
 mesh.customDepthMaterial=new THREE.MeshDepthMaterial();
 mesh.customDistanceMaterial=new THREE.MeshDistanceMaterial();
 const before=mesh.onBeforeShadow;
 mesh.onBeforeShadow=function(renderer,object,camera,shadowCamera,geometry,depth,group){
  before.call(this,renderer,object,camera,shadowCamera,geometry,depth,group);
  const source=(Array.isArray(mesh.material)?mesh.material[(group as unknown as {materialIndex?:number}|null)?.materialIndex??0]:mesh.material) as Textured|undefined;
  if(!source||(depth!==mesh.customDepthMaterial&&depth!==mesh.customDistanceMaterial))return;
  // r187 copies beauty.alphaTest in getDepthMaterial, before this public hook.
  // Apply the shadow-only threshold here, rather than modifying the beauty.
  if(needsCutout(source))depth.alphaTest=BLEND_SHADOW_CUTOFF;
  depth.opacity=source.opacity;depth.vertexColors=source.vertexColors;
 };
}
/** GLTFLoader separates primitives with different materials into Mesh objects. */
export function prepareStudioMaterials(root:THREE.Object3D):void {
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  installStudioAlphaShadows(object);
  const materials=Array.isArray(object.material)?object.material:[object.material];
  if(materials.length&&materials.every(m=>m instanceof THREE.MeshBasicMaterial)){
   object.layers.set(STUDIO_UNLIT_LAYER);object.userData.entakuStudioUnlit=true;
   for(const material of materials)material.toneMapped=false;
  }
 });
}
