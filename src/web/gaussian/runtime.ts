import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { GAUSSIAN_COLOR_LAYER, installGaussianRenderHook } from '../studio/gaussian-layers.ts';
import {nativeSurfaceDiagnostics} from './surface.ts';
import { GaussianAssetCache } from './assets.ts';
import { installGaussianSpeechGlow, hasSpeakingGaussian } from './speech-glow.ts';

/** One draw node per scene, one sorter/LoD selection per camera. Source splats
 * are shared; view accumulators, ordering and LoD index textures are not. */
export class GaussianRuntime {
  readonly assets: GaussianAssetCache;
  private drawNode?: SparkRenderer;
  private renderingView?: SparkRenderer;
  private readonly views = new Map<THREE.Camera, SparkRenderer>();
  private readonly activeCameras = new Set<THREE.Camera>();
  private readonly uninstall: () => void;
  private users = 0;
  private totalBudget = 500_000;
  private viewCount = 1;
  private stopped = false;
  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene) {
    this.assets = new GaussianAssetCache(renderer);
    this.uninstall = installGaussianRenderHook(scene, camera => this.render(camera));
  }
  setBudget(total: number, viewCount = 1): void {
    this.activeCameras.clear();
    this.totalBudget = Math.max(1000, Math.min(8_000_000, Math.floor(total)));
    this.viewCount = viewCount === 2 ? 2 : 1;
    for (const view of this.views.values()) view.lodSplatCount = Math.floor(this.totalBudget / this.viewCount);
  }
  retainVisual(): () => void {
    if (this.stopped) throw new Error('GAUSSIAN_RUNTIME_DISPOSED');
    // Asset membership changes invalidate in-flight sorts in every view. A view
    // parked during SPLIT must not flash a retired avatar when it is used again.
    this.releaseViews();
    this.users++;
    if (this.drawNode) this.drawNode.visible = true;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.users--; this.releaseViews();
    };
  }
  private createView(): SparkRenderer {
    // Standard traversal stops before expanding a node would exceed the view
    // budget. Keep that contract explicit when dividing one total across views.
    const view = new SparkRenderer({ renderer: this.renderer, lodSplatCount: Math.floor(this.totalBudget / this.viewCount), enableLod: true, enableDriveLod: true, lodTraverseMode: 'standard', lodRaycast: 0, depthTest: true, depthWrite: false });
    installGaussianSpeechGlow(view,()=>this.renderingView??view);
    view.material.toneMapped = false;
    view.layers.set(1); view.layers.enable(GAUSSIAN_COLOR_LAYER);
    view.userData.entakuGaussianRenderer = true;
    view.castShadow = view.receiveShadow = false;
    return view;
  }
  render(camera: THREE.Camera): void {
    if (this.stopped || !this.users) { this.renderer.render(this.scene, camera); return; }
    let view = this.views.get(camera);
    if (!view) {
      // The program normally has exactly main/left/right cameras. A preview or
      // camera replacement cannot leave an unbounded chain of inactive workers.
      if (this.views.size >= 3) this.releaseViews();
      view = this.createView(); this.views.set(camera, view);
      if (!this.drawNode) { this.drawNode = view; this.scene.add(view); }
    }
    this.activeCameras.add(camera);
    const target = this.renderer.getRenderTarget();
    if (target) view.renderSize.set(target.width, target.height);
    else this.renderer.getDrawingBufferSize(view.renderSize);
    const previous=this.renderingView,mask=camera.layers.mask,auto=this.renderer.autoClear,background=this.scene.background;
    this.renderingView=view;
    const backdrop=this.drawNode!.material.uniforms.speechBackdropPass!;
    try{
      if(!hasSpeakingGaussian(this.scene)||this.drawNode!.material.uniforms.rimMode?.value===0){
        view.render(this.scene,camera);
      }else{
        // The backdrop writes color, never depth. The ordinary scene draw then
        // keeps its ORIGINAL world/GS transparent sorting and draws on top.
        // Opaque walls and the desk overwrite a backdrop behind them.
        camera.layers.set(GAUSSIAN_COLOR_LAYER);
        if(!auto)this.scene.background=null; // Caller already prepared its world.
        backdrop.value=1;
        view.render(this.scene,camera);
        backdrop.value=0;
        this.renderer.autoClear=false;
        this.scene.background=null; // Do not clear a just-drawn backdrop.
        camera.layers.mask=mask;
        view.render(this.scene,camera);
      }
    }finally{
      backdrop.value=0;
      camera.layers.mask=mask;
      this.scene.background=background;
      this.renderer.autoClear=auto;
      this.renderingView=previous;
    }
  }
  diagnostics() {
    return {
      totalBudget: this.totalBudget, activeViewCount: this.viewCount, instances: this.users,
      assets: this.assets.diagnostics(),
      nativeSurfaces:nativeSurfaceDiagnostics(this.scene),
      rendererMemory: {textures:this.renderer.info.memory.textures,geometries:this.renderer.info.memory.geometries,programs:this.renderer.info.programs?.length??0},
      views: [...this.views].map(([camera, view]) => {
        const position = camera.getWorldPosition(new THREE.Vector3()), quaternion = camera.getWorldQuaternion(new THREE.Quaternion());
        let pixelScaleLimit = 0;
        if (camera instanceof THREE.PerspectiveCamera) pixelScaleLimit = 2 / camera.projectionMatrix.elements[5]! / view.renderSize.y;
        else if (camera instanceof THREE.OrthographicCamera) pixelScaleLimit = Math.min((camera.top - camera.bottom) / camera.zoom / Math.max(1, view.renderSize.y), (camera.right - camera.left) / camera.zoom / Math.max(1, view.renderSize.x));
        pixelScaleLimit *= view.lodRenderScale;
        const completed = view.currentLod, meshes = view.lodMeshes.map(record => record.mesh);
        // Spark 2.4 assigns currentLod only after updateLodInstances completes.
        // Shared meshes can dirty both views again through mappingVersion, so
        // pending refresh work does not invalidate an already matching result.
        // Its timestamp is the completed request's start, not completion latency.
        const lodMatchesView = !!completed && completed.pos.distanceTo(position) < 1e-4 &&
          1 - Math.abs(completed.quat.dot(quaternion)) < 1e-6 && completed.maxSplats === (view.lodSplatCount ?? 0) * view.lodSplatScale &&
          Math.abs(completed.pixelScaleLimit - pixelScaleLimit) <= Math.max(1e-9, pixelScaleLimit * 1e-5);
        return {
          camera: camera.uuid, active: this.activeCameras.has(camera), selectedSplats: view.activeSplats, budget: view.lodSplatCount, width: view.renderSize.x, height: view.renderSize.y,
          // Ignore cached selections for hidden/retired meshes. Display counts
          // come from the accumulator actually used by the draw node.
          lodInstances: meshes.map(mesh => view.lodInstances.get(mesh)?.numSplats ?? 0),
          displayedLodInstances: meshes.map(mesh => view.display.mapping.find(record => record.node === mesh)?.count ?? 0),
          cameraPosition: position.toArray(), cameraQuaternion: quaternion.toArray(), pixelScaleLimit,
          lodPosition: completed?.pos.toArray() ?? null, lodQuaternion: completed?.quat.toArray() ?? null, lodPixelScaleLimit: completed?.pixelScaleLimit ?? null,
          lodBudget: completed?.maxSplats ?? null, lodCompletedRequestAt: completed?.timestamp ?? null, lodRequestedAt: view.lastLod?.timestamp ?? null,
          lodMatchesView, lodPending: view.lodDirty || view.currentLod !== view.lastLod,
        };
      }),
      // Browser APIs do not expose a reliable GPU allocation or LoD peak counter.
      gpuBytes: null, lodBuildPeakBytes: null,
    };
  }
  private releaseViews(): void {
    this.drawNode?.removeFromParent(); this.drawNode = undefined;
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    this.activeCameras.clear();
  }
  dispose(): void {
    if (this.stopped) return;
    this.stopped = true; this.uninstall(); this.releaseViews(); this.assets.dispose();
  }
}
