import * as THREE from 'three';
import type {SplatMesh} from '@sparkjsdev/spark';

/** Original-asset-space bounds; set once per calibration, never scan splats in a frame. */
const boundsByMesh=new WeakMap<SplatMesh,THREE.Box3>();
export function setGaussianSpeechBounds(mesh:SplatMesh,bounds:THREE.Box3):void {
 if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw new Error('GAUSSIAN_SPEECH_BOUNDS_INVALID');
 boundsByMesh.set(mesh,bounds.clone());
}
export function clearGaussianSpeechBounds(mesh:SplatMesh):void {boundsByMesh.delete(mesh);}

/** Project the calibrated full-body box into the actual render target.
 * The result is in framebuffer pixels, not world metres or CSS pixels.
 * CUT, zoom, split cameras and render resolution are all handled per view.
 */
export function projectedGaussianHeightPixels(mesh:SplatMesh,camera:THREE.Camera,framebufferHeight:number):number|null {
 const box=boundsByMesh.get(mesh);
 if(!box||box.isEmpty()||!(framebufferHeight>0))return null;
 const transform=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(mesh.matrixWorld);
 const clip=new THREE.Vector4();
 let low=Infinity,high=-Infinity,nearCut=false;
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  clip.set(x,y,z,1).applyMatrix4(transform);
  // The camera intersects a box: the visible model can fill the screen.
  if(!Number.isFinite(clip.w)||clip.w<=0||(camera instanceof THREE.PerspectiveCamera&&clip.w<camera.near)){nearCut=true;continue;}
  const ndcY=clip.y/clip.w;
  if(!Number.isFinite(ndcY))continue;
  low=Math.min(low,ndcY);high=Math.max(high,ndcY);
 }
 if(nearCut)return framebufferHeight;
 if(!Number.isFinite(low)||!Number.isFinite(high))return null;
 const pixels=(Math.min(1,high)-Math.max(-1,low))*framebufferHeight*.5;
 return Number.isFinite(pixels)?Math.max(0,pixels):null;
}

/** Target halo dilation radius for one speaking character in output pixels.
 * At the default glow setting (4), use 6% of its projected body height.
 * A viewport-relative minimum keeps distant people legible; a maximum caps
 * nearby closeups. The 1..8 user control scales this radius by 0.25..2.
 */
export function gaussianScreenGlowRadius(mesh:SplatMesh,camera:THREE.Camera|undefined,framebufferHeight:number|undefined,scale:number):number {
 const strength=THREE.MathUtils.clamp(Number.isFinite(scale)?scale:4,1,8)/4;
 if(!camera||!Number.isFinite(framebufferHeight)||!framebufferHeight||framebufferHeight<=0)return 8.5*strength;
 const height=framebufferHeight;
 const projected=projectedGaussianHeightPixels(mesh,camera,height);
 const bodyPixels=projected===null?height*.4:projected;
 const minimum=Math.max(4,height*.012),maximum=Math.min(72,Math.max(minimum,height*.065));
 const radius=THREE.MathUtils.clamp(bodyPixels*.06,minimum,maximum);
 return radius*strength;
}
