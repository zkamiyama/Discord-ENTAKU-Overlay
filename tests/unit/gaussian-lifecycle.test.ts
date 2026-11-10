import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { PackedSplats, SplatMesh } from '@sparkjsdev/spark';
import { ResourceCache } from '../../src/web/gaussian/resource-cache.ts';
import { GaussianAvatarVisual } from '../../src/web/gaussian/avatar-visual.ts';
import type { GaussianRuntime } from '../../src/web/gaussian/runtime.ts';
import { gaussianAssetKey, type GaussianAsset, type GaussianLoadStatus } from '../../src/web/gaussian/assets.ts';
import { gaussianLocalTransform, gaussianNormalization } from '../../src/web/gaussian/transform.ts';
import type { GaussianAvatarProfile } from '../../src/assets/gaussian-profile.ts';
import {fillGaussianSpeechRanges} from '../../src/web/gaussian/speech-glow.ts';
import {Avatar} from '../../src/web/overlay/avatar.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const ready = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { ready, resolve, reject }; }
function profile(id = 'a'): GaussianAvatarProfile {
  return { kind: 'gaussian', userId: '1', assetId: id.repeat(64), scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, yawRad: 0,
    manifest: { schemaVersion: 1, kind: 'entaku-gaussian-avatar', name: id, splat: 'avatar.ply',
      coordinates: { units: 'm', up: '+Y', forward: '+Z' }, normalization: { scale: 1, rotation: [0, 0, 0], translation: [0, 0, 0] },
      faceAnchor: [0, 1.6, 0], faceBounds: { min: [-.1, 1.5, -.1], max: [.1, 1.7, .1] },
      bodyBounds: { min: [-.3, 0, -.2], max: [.3, 1.8, .2] }, framingBounds: { min: [-.3, 0, -.2], max: [.3, 1.8, .2] } } };
}
function asset(): GaussianAsset {
  const packed = new PackedSplats({ numSplats: 1, packedArray: new Uint32Array(4) });
  return { owner: new SplatMesh({ packedSplats: packed }), packed, sourceBytes: 16, inputSplats: 1, loadMs: 2, decodeAndLodMs: 3 };
}

test('shared async resource survives one participant leaving and is destroyed at the last release', async () => {
  let loads = 0, destroys = 0; const pending = deferred<{ value: number }>();
  const cache = new ResourceCache<{ value: number }, string>('loading', () => destroys++);
  const load = () => { loads++; return pending.ready; };
  const a = cache.acquire('same', load), b = cache.acquire('same', load);
  a.release(); a.release(); pending.resolve({ value: 7 });
  expect((await b.ready).value).toBe(7); expect(loads).toBe(1); expect(destroys).toBe(0);
  b.release(); expect(destroys).toBe(1); expect(cache.snapshot()).toHaveLength(0); cache.dispose(); expect(destroys).toBe(1);
});

test('late A cannot replace reacquired A after its last owner left; abandoned load is freed', async () => {
  const old = deferred<{ label: string }>(), recent = deferred<{ label: string }>(); const destroyed: string[] = [];
  const cache = new ResourceCache<{ label: string }, string>('loading', value => destroyed.push(value.label));
  const a = cache.acquire('asset', () => old.ready); a.release();
  const b = cache.acquire('asset', () => recent.ready); recent.resolve({ label: 'new' });
  expect((await b.ready).label).toBe('new'); old.resolve({ label: 'old' });
  await expect(a.ready).rejects.toThrow('GAUSSIAN_LOAD_RETIRED'); expect(destroyed).toEqual(['old']);
  expect(cache.snapshot()[0]?.value?.label).toBe('new'); b.release(); expect(destroyed).toEqual(['old', 'new']);
});

test('runtime shutdown aborts fetching and retires worker results that cannot be cancelled', async () => {
  let aborted = false, destroys = 0, signal: AbortSignal | undefined; const pending = deferred<object>();
  const cache = new ResourceCache<object, string>('loading', () => destroys++);
  const lease = cache.acquire('pending', async s => { signal = s; s.addEventListener('abort', () => { aborted = true; }); return pending.ready; });
  await Promise.resolve(); cache.dispose(); pending.resolve({});
  await expect(lease.ready).rejects.toThrow('GAUSSIAN_LOAD_RETIRED');
  expect(aborted).toBe(true); expect(signal?.aborted).toBe(true); expect(destroys).toBe(1); lease.release(); expect(destroys).toBe(1);
  expect(() => cache.acquire('later', async () => ({}))).toThrow('GAUSSIAN_RUNTIME_DISPOSED');
});

test('two visuals share packed data and transform edits/speaking do not reload or rebuild LoD', async () => {
  let loads = 0, instances = 0; const shared = asset();
  const cache = new ResourceCache<GaussianAsset, GaussianLoadStatus>({ phase: 'loading' }, a => a.owner.dispose());
  const runtime = { assets: { acquire: (p: GaussianAvatarProfile, observe: (s: GaussianLoadStatus) => void) => cache.acquire(gaussianAssetKey(p), async () => { loads++; return shared; }, observe) },
    retainVisual: () => { instances++; return () => { instances--; }; } } as unknown as GaussianRuntime;
  const first = new GaussianAvatarVisual(runtime), second = new GaussianAvatarVisual(runtime);
  const p = profile(); await Promise.all([first.setProfile(p), second.setProfile({ ...p, userId: '2' })]);
  const firstMesh = first.model.children.find(o => o instanceof SplatMesh) as SplatMesh;
  const secondMesh = second.model.children.find(o => o instanceof SplatMesh) as SplatMesh;
  expect(firstMesh.packedSplats).toBe(secondMesh.packedSplats); expect(instances).toBe(2);
  await first.setProfile({ ...p, scale: 1.2, yawRad: .7, offsetX: .1 });
  for (let n = 0; n < 20; n++) first.update(n / 20, n % 2);
  expect(loads).toBe(1); expect(first.model.children).toContain(firstMesh);
  first.dispose(); expect(secondMesh.packedSplats?.packedArray).not.toBeNull(); expect(instances).toBe(1);
  second.dispose(); expect(shared.owner.packedSplats).toBeUndefined(); expect(instances).toBe(0); cache.dispose();
});

test('slow A replaced by B, then leaving, cannot recreate a visual or overwrite latest state', async () => {
  const a = deferred<GaussianAsset>(), b = deferred<GaussianAsset>(); let instances = 0;
  const cache = new ResourceCache<GaussianAsset, GaussianLoadStatus>({ phase: 'loading' }, v => v.owner.dispose());
  const runtime = { assets: { acquire: (p: GaussianAvatarProfile, observe: (s: GaussianLoadStatus) => void) => cache.acquire(gaussianAssetKey(p), () => p.assetId[0] === 'a' ? a.ready : b.ready, observe) },
    retainVisual: () => { instances++; return () => { instances--; }; } } as unknown as GaussianRuntime;
  const visual = new GaussianAvatarVisual(runtime), loadingA = visual.setProfile(profile('a')), loadingB = visual.setProfile(profile('b'));
  const assetB = asset(); b.resolve(assetB); await loadingB; expect(instances).toBe(1);
  visual.dispose(); const assetA = asset(); a.resolve(assetA); await loadingA;
  expect(instances).toBe(0); expect(visual.root.children).toHaveLength(0);
  expect(assetA.owner.packedSplats).toBeUndefined(); expect(assetB.owner.packedSplats).toBeUndefined(); cache.dispose();
});

test('failed asset remains isolated and a later asset can load after it', async () => {
  const cache = new ResourceCache<GaussianAsset, GaussianLoadStatus>({ phase: 'loading' }, v => v.owner.dispose());
  const runtime = { assets: { acquire: (p: GaussianAvatarProfile, observe: (s: GaussianLoadStatus) => void) => cache.acquire(gaussianAssetKey(p), async () => { if (p.assetId[0] === 'a') throw new Error('corrupt'); return asset(); }, observe) }, retainVisual: () => () => {} } as unknown as GaussianRuntime;
  const visual = new GaussianAvatarVisual(runtime);
  await expect(visual.setProfile(profile('a'))).rejects.toThrow('corrupt'); expect(visual.status.phase).toBe('error');
  await visual.setProfile(profile('b')); expect(visual.status.phase).toBe('ready'); visual.dispose(); cache.dispose();
});

test('unit/axis normalization and face anchoring apply once to both GS and proxy transforms', () => {
  const p = profile(); p.manifest.coordinates = { units: 'cm', up: '+Z', forward: '-Y' };
  p.manifest.normalization = { scale: 2, rotation: [0, Math.PI / 2, 0], translation: [.2, .4, -.3] };
  const sourceFace = new THREE.Vector3(0, 0, 80);
  const canonicalFace = sourceFace.clone().applyMatrix4(gaussianNormalization(p.manifest));
  p.manifest.faceAnchor = canonicalFace.toArray(); p.scale = 1.5; p.yawRad = Math.PI / 3;
  const matrix = gaussianLocalTransform(p), anchor = sourceFace.clone().applyMatrix4(matrix);
  expect(anchor.length()).toBeLessThan(1e-10);
  const relative = sourceFace.clone().add(new THREE.Vector3(100, 0, 0)).applyMatrix4(matrix);
  expect(relative.length()).toBeCloseTo(3, 10); // 100 cm × normalization 2 × user 1.5.
});

test('proxy uses the real visual transform and stays out of color/depth while leaving shared geometry alive', async () => {
  const shared = asset(), source = new THREE.Group(), geometry = new THREE.BoxGeometry(.3, 1, .2), material = new THREE.MeshBasicMaterial();
  const sourceMesh = new THREE.Mesh(geometry, material); sourceMesh.position.y = .8; source.add(sourceMesh); shared.proxy = source;
  const cache = new ResourceCache<GaussianAsset, GaussianLoadStatus>({ phase: 'loading' }, v => v.owner.dispose());
  const runtime = { assets: { acquire: (p: GaussianAvatarProfile, observe: (s: GaussianLoadStatus) => void) => cache.acquire(gaussianAssetKey(p), async () => shared, observe) }, retainVisual: () => () => {} } as unknown as GaussianRuntime;
  const p = profile(); p.scale = 1.25; p.yawRad = Math.PI / 2;
  const visual = new GaussianAvatarVisual(runtime); visual.root.position.set(2, 3, 4); await visual.setProfile(p); visual.root.updateMatrixWorld(true);
  const instanceMesh = visual.proxyRoot!.children[0] as THREE.Mesh;
  const gs = visual.model.children.find(o => o instanceof SplatMesh)!;
  const expected = new THREE.Vector3(0, .8, 0).applyMatrix4(gs.matrixWorld);
  expect(instanceMesh.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-10);
  expect((instanceMesh.material as THREE.Material).colorWrite).toBe(false); expect((instanceMesh.material as THREE.Material).depthWrite).toBe(false);
  expect(instanceMesh.castShadow).toBe(true); expect(instanceMesh.layers.isEnabled(1)).toBe(false);
  expect(instanceMesh.geometry).toBe(geometry);
  visual.update(0, 0); expect(visual.proxyRoot!.visible).toBe(false); visual.update(.45, 0); expect(visual.proxyRoot!.visible).toBe(true);
  let geometryDisposals = 0; geometry.addEventListener('dispose', () => geometryDisposals++); visual.dispose();
  expect(geometryDisposals).toBe(0); cache.dispose(); geometry.dispose(); material.dispose();
});

test('participant speech, stale, leave, rejoin and seat movement reach the same live Gaussian without reloading', async () => {
  let loads=0;const shared=asset();
  const geometry=new THREE.BoxGeometry(.3,1,.2),material=new THREE.MeshBasicMaterial();
  shared.proxy=new THREE.Group();shared.proxy.add(new THREE.Mesh(geometry,material));
  const cache=new ResourceCache<GaussianAsset,GaussianLoadStatus>({phase:'loading'},value=>value.owner.dispose());
  const runtime={assets:{acquire:(p:GaussianAvatarProfile,observe:(s:GaussianLoadStatus)=>void)=>cache.acquire(gaussianAssetKey(p),async()=>{loads++;return shared;},observe)},retainVisual:()=>()=>{}} as unknown as GaussianRuntime;
  const visual=new GaussianAvatarVisual(runtime),p={...profile(),offsetX:.1,offsetY:.12,offsetZ:.2,yawRad:.4};await visual.setProfile(p);
  const mesh=visual.model.children.find(object=>object instanceof SplatMesh) as SplatMesh;
  // A 3DGS avatar uses the Gaussian silhouette glow, never a flat speech ring.
  expect(visual.root.children).toEqual([visual.model]);
  visual.root.traverse(object=>{if(object instanceof THREE.Mesh)expect(object.geometry).not.toBeInstanceOf(THREE.RingGeometry);});
  // Omit DOM-backed nameplate construction, but use the production Avatar
  // update/render methods and the real Gaussian visual, mesh and proxy.
  const avatar=Object.assign(Object.create(Avatar.prototype),{
    root:new THREE.Group(),plate:new THREE.Group(),opacity:0,glow:0,
    body:{material:{uniforms:{opacity:{value:0}}}},outline:{material:{uniforms:{strength:{value:0},glowScale:{value:4}}}},
    nameplate:{setName:()=>{}},context:{camera:new THREE.PerspectiveCamera(),state:()=>null},
    profile:p,profileKey:JSON.stringify(p),gaussian:visual,custom:null,
    user:{userId:'1',displayName:'fixture',presence:'present',speaking:'inactive'},
  }) as Avatar;
  avatar.root.add(visual.root);const seats=makeLayout(6).seats;let time=0;
  const frames=(seat=seats[1]!,connected=true)=>{for(let i=0;i<120;i++){time+=1000/60;avatar.render(seat,1/60,time,connected);}};
  const state=(presence:typeof avatar.user.presence,speaking:typeof avatar.user.speaking)=>avatar.update({...avatar.user,presence,speaking},p);
  try{
    frames();expect(mesh.opacity).toBeGreaterThan(.99);expect(avatar.root.visible).toBe(true);
    state('present','active');frames();
    const ranges=Array.from({length:32},()=>new THREE.Vector4()),mapping=[{node:mesh,base:512,count:1,version:0}];
    expect(fillGaussianSpeechRanges(mapping,ranges)).toBe(1);expect(ranges[0]!.z).toBeGreaterThan(.7);
    state('stale','active');frames();expect(mesh.opacity).toBeGreaterThan(.44);expect(mesh.opacity).toBeLessThan(.46);
    expect(visual.proxyRoot!.visible).toBe(true);expect(fillGaussianSpeechRanges(mapping,ranges)).toBe(0);
    state('absent','inactive');frames();expect(avatar.root.visible).toBe(false);expect(visual.proxyRoot!.visible).toBe(false);
    state('present','active');frames();expect(mesh.opacity).toBeGreaterThan(.99);expect(fillGaussianSpeechRanges(mapping,ranges)).toBe(1);
    frames(seats[3]!);const seat=seats[3]!;
    const expected=new THREE.Vector3(p.offsetX,p.offsetY,p.offsetZ).applyAxisAngle(new THREE.Vector3(0,1,0),seat.baseYawRad).add(new THREE.Vector3().fromArray(seat.faceAnchor));
    expect(avatar.root.position.distanceTo(expected)).toBeLessThan(1e-10);expect(avatar.root.rotation.y).toBe(seat.baseYawRad);
    frames(seat,false);expect(fillGaussianSpeechRanges(mapping,ranges)).toBe(0);
    expect(visual.model.children).toContain(mesh);expect(mesh.packedSplats).toBe(shared.packed);expect(loads).toBe(1);
  }finally{visual.dispose();cache.dispose();geometry.dispose();material.dispose();}
});
