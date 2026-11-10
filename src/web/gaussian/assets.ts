import * as THREE from 'three';
import { SplatMesh, type PackedSplats } from '@sparkjsdev/spark';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { GaussianAvatarProfile } from '../../assets/gaussian-profile.ts';
import { safeGaussianPath } from '../../assets/gaussian-profile.ts';
import { disposeObject } from '../studio/dispose.ts';
import { ResourceCache, type ResourceLease } from './resource-cache.ts';

export interface GaussianLoadStatus {
  phase: 'loading' | 'lod' | 'ready' | 'error';
  message?: string; inputSplats?: number; loadMs?: number; lodMs?: number;
}
export interface GaussianAsset {
  owner: SplatMesh; packed: PackedSplats; proxy?: THREE.Group;
  sourceBytes: number; inputSplats: number; loadMs: number;
  /** Public Spark initialization includes decoding and LoD generation together. */
  decodeAndLodMs: number;
}
export function gaussianFileUrl(assetId: string, path: string): string {
  return `/api/gaussian-assets/${encodeURIComponent(assetId)}/file?path=${encodeURIComponent(path)}`;
}
export function gaussianAssetKey(profile: GaussianAvatarProfile): string {
  return JSON.stringify([profile.assetId, profile.manifest.splat, profile.manifest.proxy ?? null]);
}
/** Same resolution rules and local addon decoders as the studio loader. */
async function loadProxy(bytes: ArrayBuffer, profile: GaussianAvatarProfile, renderer: THREE.WebGLRenderer): Promise<THREE.Group> {
  const manager = new THREE.LoadingManager();
  const virtualRoot = new URL(`/__gaussian/${profile.assetId}/`, location.origin);
  const source = new URL(profile.manifest.proxy!.split('/').map(encodeURIComponent).join('/'), virtualRoot);
  const draco = new DRACOLoader().setDecoderPath('/static/decoders/draco/').setWorkerLimit(2);
  const ktx = new KTX2Loader().setTranscoderPath('/static/decoders/basis/').setWorkerLimit(2).detectSupport(renderer);
  let failed = false, model: THREE.Group | undefined;
  manager.onError = () => { failed = true; };
  manager.setURLModifier(url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const resolved = new URL(url, source);
    if (!resolved.href.startsWith(virtualRoot.href) || resolved.search || resolved.hash) throw new Error('GAUSSIAN_RESOURCE_REJECTED');
    return gaussianFileUrl(profile.assetId, safeGaussianPath(decodeURIComponent(resolved.pathname.slice(virtualRoot.pathname.length))));
  });
  try {
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(bytes, new URL('.', source).href);
    model = gltf.scene;
    if (failed) throw new Error('GAUSSIAN_PROXY_DEPENDENCY_FAILED');
    let meshes = 0, triangles = 0;
    model.traverse(object => {
      if (object instanceof THREE.Mesh) {
        meshes++;
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
      }
    });
    if (!meshes || meshes > 5000 || triangles > 2_000_000) throw new Error('GAUSSIAN_PROXY_GEOMETRY_LIMIT');
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error('GAUSSIAN_PROXY_GEOMETRY_INVALID');
    return model;
  } catch (error) { if (model) disposeObject(model); throw error; }
  finally { draco.dispose(); ktx.dispose(); }
}
export function packedCpuBytes(packed: PackedSplats | undefined): number {
  if (!packed) return 0;
  return (packed.packedArray?.byteLength ?? 0) + Object.values(packed.extra).reduce<number>((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0);
}
export class GaussianAssetCache {
  private readonly cache = new ResourceCache<GaussianAsset, GaussianLoadStatus>({ phase: 'loading' }, value => {
    value.owner.dispose();
    if (value.proxy) disposeObject(value.proxy);
  });
  constructor(private readonly renderer: THREE.WebGLRenderer) {}
  acquire(profile: GaussianAvatarProfile, observe: (status: GaussianLoadStatus) => void): ResourceLease<GaussianAsset> {
    return this.cache.acquire(gaussianAssetKey(profile), async (signal, status) => {
      const started = performance.now();
      let owner: SplatMesh | undefined, proxy: THREE.Group | undefined;
      try {
        const paths = [profile.manifest.splat, ...(profile.manifest.proxy ? [profile.manifest.proxy] : [])];
        const bytes = await Promise.all(paths.map(async path => {
          const response = await fetch(gaussianFileUrl(profile.assetId, path), { signal });
          if (!response.ok) throw new Error('GAUSSIAN_ASSET_UNAVAILABLE');
          return response.arrayBuffer();
        }));
        if (signal.aborted) throw new Error('GAUSSIAN_LOAD_RETIRED');
        const loadMs = performance.now() - started;
        status({ phase: 'lod', loadMs });
        const decoding = performance.now();
        // Retain the original to measure input count separately from the hierarchy.
        // The cached owner is never attached to a scene; instances borrow its data.
        owner = new SplatMesh({ fileBytes: bytes[0]!, fileName: profile.manifest.splat, lod: true, nonLod: true, editable: false, raycastable: false });
        const parsed = await Promise.allSettled([owner.initialized, bytes[1] ? loadProxy(bytes[1], profile, this.renderer) : Promise.resolve(undefined)]);
        if (parsed[1].status === 'fulfilled') proxy = parsed[1].value;
        for (const result of parsed) if (result.status === 'rejected') throw result.reason;
        const packed = owner.packedSplats;
        if (!packed || !packed.lodSplats || !packed.numSplats) throw new Error('GAUSSIAN_LOD_UNAVAILABLE');
        const decodeAndLodMs = performance.now() - decoding, inputSplats = packed.numSplats;
        status({ phase: 'ready', loadMs, lodMs: decodeAndLodMs, inputSplats });
        return { owner, packed, proxy, sourceBytes: bytes.reduce((sum, buffer) => sum + buffer.byteLength, 0), inputSplats, loadMs, decodeAndLodMs };
      } catch (error) {
        owner?.dispose(); if (proxy) disposeObject(proxy);
        status({ phase: 'error', message: '素材を読み込めません。形式・参照ファイル・端末の対応状況を確認してください。' });
        throw error;
      }
    }, observe);
  }
  diagnostics() {
    return this.cache.snapshot().map(entry => ({
      references: entry.references, phase: entry.status.phase,
      inputSplats: entry.value?.inputSplats ?? 0, sourceBytes: entry.value?.sourceBytes ?? 0,
      originalCpuBytes: packedCpuBytes(entry.value?.packed), lodCpuBytes: packedCpuBytes(entry.value?.packed.lodSplats),
      loadMs: entry.value?.loadMs ?? null, decodeAndLodMs: entry.value?.decodeAndLodMs ?? null,
    }));
  }
  dispose(): void { this.cache.dispose(); }
}
