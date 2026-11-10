import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { GAUSSIAN_COLOR_LAYER, installGaussianRenderHook } from '../studio/gaussian-layers.ts';
import { GaussianAssetCache } from './assets.ts';
import { prepareGaussianColor } from './color-space.ts';

/** One draw node per scene, one sorter/LoD selection per camera. Source splats
 * are shared; view accumulators, ordering and LoD index textures are not. */
export class GaussianRuntime {
  readonly assets: GaussianAssetCache;
  private drawNode?: SparkRenderer;
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
    prepareGaussianColor(view.material);
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
    view.render(this.scene, camera);
  }
  diagnostics() {
    return {
      totalBudget: this.totalBudget, activeViewCount: this.viewCount, instances: this.users,
      assets: this.assets.diagnostics(),
      rendererMemory: {textures:this.renderer.info.memory.textures,geometries:this.renderer.info.memory.geometries,programs:this.renderer.info.programs?.length??0},
      views: [...this.views].map(([camera, view]) => ({ camera: camera.uuid, active: this.activeCameras.has(camera), selectedSplats: view.activeSplats, budget: view.lodSplatCount, width: view.renderSize.x, height: view.renderSize.y, lodInstances: [...view.lodInstances.values()].map(v => v.numSplats), cameraPosition: camera.getWorldPosition(new THREE.Vector3()).toArray(), lodPosition: view.currentLod?.pos.toArray() ?? null, lodBudget: view.currentLod?.maxSplats ?? null, lodPending: view.lodDirty || view.currentLod !== view.lastLod })),
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
