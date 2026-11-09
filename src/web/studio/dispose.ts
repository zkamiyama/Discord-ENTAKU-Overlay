import * as THREE from 'three';
/** Resources are owned by one imported scene. Use Three.js disposal hooks, once per resource. */
export function disposeObject(root:THREE.Object3D):void {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  const textures=new Set<THREE.Texture>(),images=new Set<ImageBitmap>(),skeletons=new Set<THREE.Skeleton>();
  root.traverse(object=>{
    if(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.Points){
      geometries.add(object.geometry);
      if(object instanceof THREE.Mesh){if(object.customDepthMaterial)materials.add(object.customDepthMaterial);if(object.customDistanceMaterial)materials.add(object.customDistanceMaterial);}
      for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
    }
    if(object instanceof THREE.SkinnedMesh)skeletons.add(object.skeleton);
    if(object instanceof THREE.InstancedMesh)object.dispose();
  });
  const addTexture=(value:unknown):void=>{
    if(value instanceof THREE.Texture)textures.add(value);
    else if(Array.isArray(value))for(const item of value)if(item instanceof THREE.Texture)textures.add(item);
  };
  for(const material of materials){
    for(const value of Object.values(material))addTexture(value);
    if(material instanceof THREE.ShaderMaterial)for(const uniform of Object.values(material.uniforms))addTexture(uniform.value);
  }
  for(const texture of textures){
    const values=Array.isArray(texture.image)?texture.image:[texture.image];
    for(const image of values)if(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap)images.add(image);
    texture.dispose();
  }
  for(const image of images)image.close();
  for(const skeleton of skeletons)skeleton.dispose();
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
  root.removeFromParent();root.clear();
}
