import * as THREE from 'three';
import {SplatMesh,type SparkRenderer} from '@sparkjsdev/spark';

/** Spark's completed LoD request records the camera and pixel scale it used.
 * A pending refresh does not invalidate an already matching selection. */
export function gaussianViewSelection(view:SparkRenderer,camera:THREE.Camera){
 const position=camera.getWorldPosition(new THREE.Vector3()),quaternion=camera.getWorldQuaternion(new THREE.Quaternion());
 let pixelScaleLimit=0;
 if(camera instanceof THREE.PerspectiveCamera)pixelScaleLimit=2/camera.projectionMatrix.elements[5]!/view.renderSize.y;
 else if(camera instanceof THREE.OrthographicCamera)pixelScaleLimit=Math.min((camera.top-camera.bottom)/camera.zoom/Math.max(1,view.renderSize.y),(camera.right-camera.left)/camera.zoom/Math.max(1,view.renderSize.x));
 pixelScaleLimit*=view.lodRenderScale;
 const completed=view.currentLod;
 // Match Spark 2.4 driveLod's motion threshold. A stricter startup comparison
 // can wait forever after a sub-threshold move that native LoD will not refresh.
 const poseSimilarity=completed?Math.max(0,1-completed.pos.distanceTo(position))*Math.max(0,1-(1-Math.abs(completed.quat.dot(quaternion)))/.01):0;
 const lodMatchesView=!!completed&&poseSimilarity>=.999&&
  completed.maxSplats===(view.lodSplatCount??0)*view.lodSplatScale&&
  Math.abs(completed.pixelScaleLimit-pixelScaleLimit)<=Math.max(1e-9,pixelScaleLimit*1e-5);
 return {position,quaternion,pixelScaleLimit,lodMatchesView};
}

interface Preparation {ready:boolean;pending:boolean;failed:boolean;error?:unknown}

/** A new view must not rasterize Spark's temporary full-source fallback.
 * Public update() advances native generation, LoD and async depth sorting while
 * the scene draw node is hidden. Its resolution alone does not mean LoD is ready.
 * Once ready, the view retains Spark's normal progressive update behavior.
 */
export class GaussianViewPreparation {
 private readonly views=new Map<SparkRenderer,Preparation>();
 private epoch=0;
 isReady(view:SparkRenderer):boolean{return this.views.get(view)?.ready??false;}
 private initializeTextures(view:SparkRenderer):void {
  // Spark 2.4 updates existing sort/LoD textures through GPU sub-uploads once
  // Three owns them. Before their first upload, a later sort only marks the old
  // CPU image dirty (and LoD updates skip upload). A normal first draw hides
  // that assumption. Initialize through Three's public API while draws are
  // deferred, so subsequent native updates reach the actual GPU textures.
  if(view.orderingTexture)view.renderer.initTexture(view.orderingTexture);
  for(const {texture} of view.lodInstances.values())view.renderer.initTexture(texture);
 }
 advance(view:SparkRenderer,scene:THREE.Scene,camera:THREE.Camera):boolean {
  let state=this.views.get(view);
  if(!state){state={ready:false,pending:false,failed:false};this.views.set(view,state);}
  if(state.failed)throw new Error('GAUSSIAN_VIEW_PREPARATION_FAILED',{cause:state.error});
  if(state.ready)return true;
  this.initializeTextures(view);
  if(state.pending)return false;
  // A retained visual can still be loading. Leave it cold until a real source
  // exists, so an empty initial scene cannot bypass preparation when it arrives.
  let hasSource=false;
  scene.traverseVisible(object=>{if(object instanceof SplatMesh&&object.isInitialized&&camera.layers.test(object.layers))hasSource=true;});
  if(!hasSource)return false;
  const selection=gaussianViewSelection(view,camera);
  const budget=(view.lodSplatCount??0)*view.lodSplatScale;
  const displayed=selection.lodMatchesView&&!view.sorting&&!view.sortDirty&&view.activeSplats<=budget&&
   view.lodMeshes.every(({mesh})=>{
    const instance=view.lodInstances.get(mesh);
    return !!instance&&(view.display.mapping.find(record=>record.node===mesh)?.count??0)===instance.numSplats;
   });
  if(displayed){state.ready=true;return true;}
  // Explicit updates always generate the current view. Also request selection
  // when its completed request is stale, including a camera change while an
  // earlier startup request was in flight.
  if(!selection.lodMatchesView)view.lodDirty=true;
  state.pending=true;
  const epoch=this.epoch,owned=state;
  // Exactly one explicit update per view is in flight. Call synchronously so
  // Spark captures this pass's camera layers/matrices before they are restored.
  void view.update({scene,camera}).then(()=>{
   if(epoch===this.epoch&&this.views.get(view)===owned){
    try{this.initializeTextures(view);}catch(error){owned.failed=true;owned.error=error;}
    owned.pending=false;
   }
  },error=>{
   if(epoch===this.epoch&&this.views.get(view)===owned){owned.pending=false;owned.failed=true;owned.error=error;}
  });
  return false;
 }
 clear():void {this.epoch++;this.views.clear();}
}
