import * as THREE from 'three';
import {saveRenderState} from './render-state.ts';

/** These are object layers, not inherited Group flags. The color node also uses
 * DISPLAY_LAYER; proxy geometry deliberately never belongs to that layer. */
export const GAUSSIAN_COLOR_LAYER=3;
export const GAUSSIAN_PROXY_LAYER=4;

type RenderHook=(camera:THREE.Camera)=>void;
const hooks=new WeakMap<THREE.Scene,RenderHook>();

/** Spark's public render override routes the sole scene node through the
 * current view's sorter. Registering it here keeps studio passes independent of
 * the asset/worker service, and never replaces WebGLRenderer.render globally. */
export function installGaussianRenderHook(scene:THREE.Scene,hook:RenderHook):()=>void {
 hooks.set(scene,hook);
 return ()=>{if(hooks.get(scene)===hook)hooks.delete(scene);};
}
export function renderSceneWithGaussians(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera):void {
 const hook=hooks.get(scene);
 if(hook&&(camera.layers.isEnabled(1)||camera.layers.isEnabled(GAUSSIAN_COLOR_LAYER)))hook(camera);
 else renderer.render(scene,camera);
}
export function hasGaussianColor(scene:THREE.Scene):boolean {
 let found=false;
 scene.traverseVisible(object=>{if(object.layers.isEnabled(GAUSSIAN_COLOR_LAYER)&&(object instanceof THREE.Mesh||object.userData.entakuGaussianRenderer||object.userData.entakuGaussianInstance))found=true;});
 return found;
}
export function hasGaussianProxy(scene:THREE.Scene):boolean {
 let found=false;
 scene.traverseVisible(object=>{if(object instanceof THREE.Mesh&&object.layers.isEnabled(GAUSSIAN_PROXY_LAYER))found=true;});
 return found;
}

/** Write geometry only after splat COLOR is complete. Using the same target
 * before splat color would make a character occlude itself. The main world
 * depth is never passed here: only SSR beauty or an avatar-inclusive DoF target. */
export class GaussianProxyDepthPass {
 private material=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,depthTest:true,side:THREE.DoubleSide,toneMapped:false});
 render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera):void {
  if(!hasGaussianProxy(scene))return;
  const restore=saveRenderState(renderer,scene,camera),override=scene.overrideMaterial;
  try{
   camera.layers.set(GAUSSIAN_PROXY_LAYER);scene.background=null;scene.overrideMaterial=this.material;renderer.autoClear=false;
   renderer.render(scene,camera);
  }finally{scene.overrideMaterial=override;restore();}
 }
 dispose():void {this.material.dispose();}
}

/** Include only world-space caster state. Camera CUTs and view sorting cannot
 * invalidate a static shadow; moves, visibility, proxy replacement and lights can. */
export function gaussianShadowKey(scene:THREE.Scene):string {
 const rows:string[]=[];
 scene.updateMatrixWorld(true);
 scene.traverseVisible(object=>{
  if((object instanceof THREE.Mesh&&(object.layers.isEnabled(GAUSSIAN_PROXY_LAYER)||object.userData.entakuGaussianSurface))||object instanceof THREE.DirectionalLight||object instanceof THREE.SpotLight){
   const transform=object.matrixWorld.elements.map(n=>Math.round(n*1e6)/1e6).join(',');
   if(object instanceof THREE.Mesh)rows.push(object.uuid+':'+object.geometry.uuid+':'+transform);
   else if(object instanceof THREE.DirectionalLight||object instanceof THREE.SpotLight){
    object.target.updateWorldMatrix(true,false);
    rows.push(object.uuid+':'+transform+':'+object.intensity+':'+object.target.matrixWorld.elements.map(n=>Math.round(n*1e6)/1e6).join(','));
   }
  }
 });
 return rows.sort().join('|');
}
