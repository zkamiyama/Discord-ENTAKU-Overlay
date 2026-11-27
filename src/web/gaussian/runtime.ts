import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { GAUSSIAN_COLOR_LAYER, installGaussianRenderHook } from '../studio/gaussian-layers.ts';
import {nativeSurfaceDiagnostics} from './surface.ts';
import { GaussianAssetCache } from './assets.ts';
import { installGaussianSpeechGlow, hasSpeakingGaussian } from './speech-glow.ts';
import {GaussianSpeechHaloPool} from './speech-halo.ts';
import {GaussianViewPreparation,gaussianViewSelection} from './view-preparation.ts';

/** One draw node per scene, one sorter/LoD selection per camera. Source splats
 * are shared; view accumulators, ordering and LoD index textures are not. */
export class GaussianRuntime {
  readonly assets: GaussianAssetCache;
  private drawNode?: SparkRenderer;
  private renderingView?: SparkRenderer;
  private halos?:GaussianSpeechHaloPool;
  private readonly views = new Map<THREE.Camera, SparkRenderer>();
  private readonly preparation=new GaussianViewPreparation();
  private readonly activeCameras = new Set<THREE.Camera>();
  private readonly uninstall: () => void;
  private users = 0;
  private membershipVersion=0;
  get membershipRevision():number{return this.membershipVersion;}
  private totalBudget = 500_000;
  private viewCount = 1;
  private stopped = false;
  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene) {
    this.assets = new GaussianAssetCache(renderer);
    this.uninstall = installGaussianRenderHook(scene, camera => this.render(camera));
  }
  setBudget(total: number, viewCount = 1): void {
    this.activeCameras.clear();
    const budget = Math.max(1000, Math.min(8_000_000, Math.floor(total)));
    const count = viewCount === 2 ? 2 : 1;
    if (budget === this.totalBudget && count === this.viewCount) return;
    this.totalBudget = budget;
    this.viewCount = count;
    for (const view of this.views.values()) view.lodSplatCount = Math.floor(this.totalBudget / this.viewCount);
  }
  retainVisual(): () => void {
    if (this.stopped) throw new Error('GAUSSIAN_RUNTIME_DISPOSED');
    // Addition leaves the existing displayed mapping valid. Spark's native
    // mappingVersion transition adds the new generator without blanking all
    // existing participants. Removal is different: no stale mapping is safe.
    this.users++;this.membershipVersion++;
    for(const view of this.views.values())view.setDirty();
    if (this.drawNode) this.drawNode.visible = true;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.users--;this.membershipVersion++;this.releaseViews();
    };
  }
  private createView(): SparkRenderer {
    // Standard traversal stops before expanding a node would exceed the view
    // budget. Keep that contract explicit when dividing one total across views.
    const view = new SparkRenderer({ renderer: this.renderer, autoUpdate:false,lodSplatCount: Math.floor(this.totalBudget / this.viewCount), enableLod: true, enableDriveLod: true, lodTraverseMode: 'standard', lodRaycast: 0, depthTest: true, depthWrite: false });
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
    if(!this.preparation.isReady(view)){
      // Explicit Spark updates run before WebGLRenderer's normal matrix update.
      if(this.scene.matrixWorldAutoUpdate)this.scene.updateMatrixWorld();
      if(camera.parent===null&&camera.matrixWorldAutoUpdate)camera.updateMatrixWorld();
      if(!this.preparation.advance(view,this.scene,camera)){
        this.halos?.hide();
        const node=this.drawNode!,visible=node.visible;node.visible=false;
        try{this.renderer.render(this.scene,camera);}finally{node.visible=visible;}
        return;
      }
      view.autoUpdate=true;
    }
    const previous=this.renderingView,autoUpdate=view.autoUpdate;
    this.renderingView=view;
    const material=this.drawNode!.material,maskPass=material.uniforms.speechMaskPass!,depthWrite=material.depthWrite;
    this.halos?.hide();
    try{
      if(hasSpeakingGaussian(this.scene)&&material.uniforms.rimMode?.value===2){
        this.halos??=new GaussianSpeechHaloPool(this.scene);
        const halo=this.halos.acquire(view.renderSize.x,view.renderSize.y);
        halo.prepare(this.renderer,this.scene,camera,()=>{
          try{
            maskPass.value=1;material.depthWrite=true;
            view!.render(this.scene,camera);
            let radius=0;
            for(const range of material.uniforms.speakerRanges!.value as THREE.Vector4[])radius=Math.max(radius,range.w);
            return radius;
          }finally{maskPass.value=0;material.depthWrite=depthWrite;}
        },material.uniforms.rimTint!.value);
        // The mask already prepared this camera's current native mapping. The
        // color draw must reuse it, not enqueue another sort/LoD update.
        view.autoUpdate=false;
      }
      // The halo is a transparent scene draw before normal transparent color.
      // Three retains background, opaque depth, native ordering and alpha.
      view.render(this.scene,camera);
    }finally{
      maskPass.value=0;material.depthWrite=depthWrite;view.autoUpdate=autoUpdate;
      this.halos?.hide();
      this.renderingView=previous;
    }
  }
  /** Hot-path counters only. Detailed scene/asset diagnostics are on demand. */
  frameSummary() {
    let selectedSplats = 0;
    for (const camera of this.activeCameras){const view=this.views.get(camera);if(view&&this.preparation.isReady(view))selectedSplats+=view.activeSplats;}
    return { instances: this.users, assets: this.assets.size, selectedSplats };
  }
  diagnostics() {
    return {
      totalBudget: this.totalBudget, activeViewCount: this.viewCount, instances: this.users, membershipRevision:this.membershipVersion,
      assets: this.assets.diagnostics(),
      nativeSurfaces:nativeSurfaceDiagnostics(this.scene),
      rendererMemory: {textures:this.renderer.info.memory.textures,geometries:this.renderer.info.memory.geometries,programs:this.renderer.info.programs?.length??0},
      views: [...this.views].map(([camera, view]) => {
        const {position,quaternion,pixelScaleLimit,lodMatchesView}=gaussianViewSelection(view,camera);
        const completed = view.currentLod, meshes = view.lodMeshes.map(record => record.mesh);
        // Spark 2.4 assigns currentLod only after updateLodInstances completes.
        // Shared meshes can dirty both views again through mappingVersion, so
        // pending refresh work does not invalidate an already matching result.
        // Its timestamp is the completed request's start, not completion latency.
        return {
          camera: camera.uuid, active: this.activeCameras.has(camera), ready:this.preparation.isReady(view),selectedSplats: view.activeSplats, budget: view.lodSplatCount, width: view.renderSize.x, height: view.renderSize.y,
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
    this.preparation.clear();
    this.halos?.dispose();this.halos=undefined;
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
