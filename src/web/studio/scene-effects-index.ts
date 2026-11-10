import {GAUSSIAN_SURFACE_LAYER,GaussianSurface} from '../gaussian/surface.ts';
import * as THREE from 'three';
import {STUDIO_UNLIT_LAYER,installStudioAlphaShadows} from './studio-materials.ts';
import type {QualitySettings} from '../../studio/quality.ts';
import {GAUSSIAN_COLOR_LAYER,GAUSSIAN_PROXY_LAYER,gaussianShadowKey} from './gaussian-layers.ts';
type ShadowLight=THREE.DirectionalLight|THREE.SpotLight;
/** Seat reservations survive departures; the props' visibility does not. */
export function visibleCasterKey(objects:Iterable<THREE.Object3D>):string {
 const ids:string[]=[];for(const object of objects)if(object.visible)ids.push(object.uuid);
 return ids.sort().join(',');
}
/** Callers change source when geometry/materials/visibility change. Camera-only
 * movement does not invalidate world-space shadows or reflection receivers. */
export class SceneEffectsIndex {
 private key='';
 lights:ShadowLight[]=[];
 reflective:THREE.Mesh[]=[];
 hasUnlit=false;
 update(renderer:THREE.WebGLRenderer,scene:THREE.Scene,q:QualitySettings,source:string,displayLayer:number):boolean {
  renderer.shadowMap.enabled=q.shadows==='soft';renderer.shadowMap.type=THREE.PCFShadowMap;
  const key=[scene.uuid,source,q.shadows,q.shadowSize,q.shadowLights,q.reflections,displayLayer,q.gaussianAlphaClip,gaussianShadowKey(scene)].join('|');
  if(key===this.key)return false;
  this.key=key;this.lights=[];this.reflective=[];this.hasUnlit=false;
  let desk:THREE.Object3D|undefined;
  const candidates:ShadowLight[]=[];
  scene.traverse(o=>{
   if(o.userData.entakuDesk)desk=o;
   if(o instanceof GaussianSurface){o.alphaClip=q.gaussianAlphaClip;o.castShadow=true;o.receiveShadow=false;}
   else if(o instanceof THREE.Mesh&&o.userData.entakuGaussianRenderer){o.castShadow=false;o.receiveShadow=false;}
   else if(o instanceof THREE.Mesh&&!o.layers.isEnabled(displayLayer)&&!o.layers.isEnabled(GAUSSIAN_COLOR_LAYER)){
    o.castShadow=true;o.receiveShadow=!o.userData.entakuStudioUnlit&&!o.layers.isEnabled(GAUSSIAN_PROXY_LAYER);installStudioAlphaShadows(o);
    if(o.userData.entakuStudioUnlit)this.hasUnlit=true;
   }
   if(o instanceof THREE.DirectionalLight||o instanceof THREE.SpotLight)o.castShadow=false;
  });
  scene.traverseVisible(o=>{
   if((o instanceof THREE.DirectionalLight||o instanceof THREE.SpotLight)&&o.intensity>0)candidates.push(o);
   if(o instanceof THREE.Mesh&&!o.userData.entakuGaussianRenderer&&!o.layers.isEnabled(displayLayer)&&!o.layers.isEnabled(GAUSSIAN_COLOR_LAYER)&&!o.layers.isEnabled(GAUSSIAN_PROXY_LAYER)&&!o.layers.isEnabled(GAUSSIAN_SURFACE_LAYER)){
    const materials=Array.isArray(o.material)?o.material:[o.material];
    if(o.userData.entakuReflective||materials.some(m=>m instanceof THREE.MeshStandardMaterial&&(m.metalness>.2||m.roughness<.45)))this.reflective.push(o);
   }
  });
  if(q.shadows==='soft')this.lights=candidates.sort((a,b)=>Number(b instanceof THREE.DirectionalLight)-Number(a instanceof THREE.DirectionalLight)||b.intensity-a.intensity).slice(0,q.shadowLights);
  for(const light of this.lights){
   light.castShadow=true;light.shadow.autoUpdate=false;
   light.shadow.camera.layers.set(0);light.shadow.camera.layers.enable(STUDIO_UNLIT_LAYER);light.shadow.camera.layers.enable(GAUSSIAN_PROXY_LAYER);light.shadow.camera.layers.enable(GAUSSIAN_SURFACE_LAYER);
   if(light.shadow.mapSize.x!==q.shadowSize){light.shadow.map?.dispose();light.shadow.map=null;light.shadow.mapSize.set(q.shadowSize,q.shadowSize);}
   light.shadow.bias=-.00005;light.shadow.normalBias=.012;light.shadow.radius=2.5;
   light.shadow.camera.near=.1;light.shadow.camera.far=Math.max(60,light.shadow.camera.far);light.shadow.camera.updateProjectionMatrix();light.shadow.needsUpdate=true;
  }
  if(desk&&this.lights.length){
   desk.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(desk).expandByScalar(.5);bounds.max.y+=3;
   for(const light of this.lights)if(light instanceof THREE.DirectionalLight){
    light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);light.shadow.updateMatrices(light);
    const box=bounds.clone().applyMatrix4(light.shadow.camera.matrixWorldInverse),c=light.shadow.camera;
    c.left=box.min.x;c.right=box.max.x;c.bottom=box.min.y;c.top=box.max.y;c.near=Math.max(.05,-box.max.z);c.far=Math.max(c.near+10,-box.min.z+5);c.updateProjectionMatrix();
   }
  }
  renderer.shadowMap.needsUpdate=true;
  return true;
 }
 invalidate():void {this.key='';}
}
