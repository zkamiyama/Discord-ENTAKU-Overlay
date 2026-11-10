import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GaussianAvatarProfile } from '../../assets/gaussian-profile.ts';
import { GAUSSIAN_COLOR_LAYER, GAUSSIAN_PROXY_LAYER } from '../studio/gaussian-layers.ts';
import { GaussianRuntime } from './runtime.ts';
import { gaussianAssetKey, type GaussianAsset, type GaussianLoadStatus } from './assets.ts';
import type { ResourceLease } from './resource-cache.ts';
import {GaussianSurface} from './surface.ts';
import { gaussianLocalTransform } from './transform.ts';
import {setGaussianSpeechGlow,clearGaussianSpeechGlow} from './speech-glow.ts';
export type { GaussianLoadStatus } from './assets.ts';

export class GaussianAvatarVisual {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  proxyRoot?: THREE.Group;
  surface?:GaussianSurface;
  get geometryRoot():THREE.Object3D|undefined{return this.proxyRoot??this.surface;}
  status: GaussianLoadStatus = { phase: 'loading' };
  private mesh?: SplatMesh;
  private proxyMaterial?: THREE.MeshBasicMaterial;
  private lease?: ResourceLease<GaussianAsset>;
  private releaseVisual?: () => void;
  private generation = 0;
  private key = '';
  private profile?: GaussianAvatarProfile;
  private stopped = false;
  private loading: Promise<void> = Promise.resolve();
  constructor(private readonly runtime: GaussianRuntime, private readonly onStatus: (status: GaussianLoadStatus) => void = () => {}) {
    this.root.name = '3DGS avatar'; this.root.add(this.model);
    this.model.matrixAutoUpdate = false;
  }
  private publish(status: GaussianLoadStatus): void { this.status = status; this.onStatus(status); }
  setProfile(profile: GaussianAvatarProfile): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('GAUSSIAN_VISUAL_DISPOSED'));
    this.profile = profile; this.applyTransform();
    const key = gaussianAssetKey(profile);
    if (key === this.key && this.status.phase !== 'error') return this.loading;
    this.key = key;
    const generation = ++this.generation;
    this.clearAsset();
    this.lease = this.runtime.assets.acquire(profile, status => {
      if (!this.stopped && generation === this.generation && status.phase !== 'ready') this.publish(status);
    });
    const lease = this.lease;
    this.loading = lease.ready.then(asset => {
      if (this.stopped || generation !== this.generation) return;
      const mesh = new SplatMesh({ packedSplats: asset.packed, editable: false, raycastable: false });
      mesh.layers.set(1); mesh.layers.enable(GAUSSIAN_COLOR_LAYER);
      mesh.userData.entakuGaussianInstance = true;
      this.mesh = mesh; this.model.add(mesh);
      if (asset.proxy) {
        const proxy = clone(asset.proxy) as THREE.Group;
        this.proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false });
        proxy.traverse(object => {
          object.layers.set(GAUSSIAN_PROXY_LAYER);
          if (object instanceof THREE.Mesh) {
            object.material = this.proxyMaterial!;
            object.castShadow = true; object.receiveShadow = false;
            object.userData.entakuGaussianProxy = true;
          }
        });
        this.proxyRoot = proxy; this.model.add(proxy);
      }else{this.surface=new GaussianSurface(asset.packed);this.model.add(this.surface);}
      this.releaseVisual = this.runtime.retainVisual();
      this.applyTransform();
      this.publish({ phase: 'ready', inputSplats: asset.inputSplats, loadMs: asset.loadMs, lodMs: asset.decodeAndLodMs });
    }).catch(error => {
      if (this.stopped || generation !== this.generation) return;
      this.clearAsset();
      this.publish({ phase: 'error', message: '素材を読み込めません。取り込み直すか、設定を確認してください。' });
      throw error;
    });
    return this.loading;
  }
  private applyTransform(): void {
    if (!this.profile) return;
    this.model.matrix.copy(gaussianLocalTransform(this.profile));
    this.model.matrixWorldNeedsUpdate = true;
  }
  update(opacity: number, speaking: number, glowScale=4): void {
    if (this.mesh) {this.mesh.opacity = opacity;setGaussianSpeechGlow(this.mesh,opacity>.005?speaking:0,glowScale);}
    // Shadows and SSR geometry disappear at the same visibility threshold as the avatar.
    if (this.geometryRoot) this.geometryRoot.visible = opacity > .005;
  }
  private clearAsset(): void {
    this.surface?.dispose();this.surface=undefined;
    if (this.mesh) {
      clearGaussianSpeechGlow(this.mesh);
      this.mesh.removeFromParent();
      // SplatMesh.dispose owns its data by default. Instances only borrow it.
      this.mesh.packedSplats = undefined; this.mesh.splats = undefined;
      this.mesh.dispose(); this.mesh = undefined;
    }
    if (this.proxyRoot) {
      this.proxyRoot.traverse(object => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
        if (object instanceof THREE.Mesh) { object.customDepthMaterial?.dispose(); object.customDistanceMaterial?.dispose(); }
      });
      this.proxyRoot.removeFromParent(); this.proxyRoot.clear(); this.proxyRoot = undefined;
    }
    this.proxyMaterial?.dispose(); this.proxyMaterial = undefined;
    this.releaseVisual?.(); this.releaseVisual = undefined;
    this.lease?.release(); this.lease = undefined;
  }
  dispose(): void {
    if (this.stopped) return;
    this.stopped = true; this.generation++; this.clearAsset();
    this.root.removeFromParent(); this.root.clear();
  }
}
