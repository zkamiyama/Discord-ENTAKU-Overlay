/** Character geometry is expressed after source axes/units and normalization,
 * in right-handed metres, +Y up and +Z forward. It is independent of a user. */
export type GaussianVec3 = readonly [number, number, number];
export interface GaussianBounds { min: GaussianVec3; max: GaussianVec3 }
export type GaussianAxis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
export interface GaussianAvatarManifest {
  schemaVersion: 1;
  kind: 'entaku-gaussian-avatar';
  name: string;
  splat: string;
  proxy?: string;
  preview?: string;
  coordinates: { units: 'm' | 'cm' | 'mm'; up: GaussianAxis; forward: GaussianAxis };
  normalization: { scale: number; rotation: GaussianVec3; translation: GaussianVec3 };
  faceAnchor: GaussianVec3;
  faceBounds: GaussianBounds;
  bodyBounds: GaussianBounds;
  framingBounds: GaussianBounds;
  placement?: {scale:number;offsetX:number;offsetY:number;offsetZ:number;yawRad:number};
}
export interface GaussianAvatarProfile {
  kind: 'gaussian'; userId: string; assetId: string; manifest: GaussianAvatarManifest;
  scale: number; offsetX: number; offsetY: number; offsetZ: number; yawRad: number;
  // These keys are never serialized. They allow safe inspection of old snapshots
  // while keeping image-only editing/rendering dependent on the discriminant.
  image?: never; faceRect?: never; back?: never; framingRect?: never;
}
export const GAUSSIAN_LIMITS = Object.freeze({
  fileBytes: 128 * 1024 * 1024, archiveBytes: 192 * 1024 * 1024,
  unpackedBytes: 256 * 1024 * 1024, files: 64, splats: 1_000_000,
  storeAssets: 128, storeBytes: 1024 * 1024 * 1024, activeSplats: 8_000_000,
  manifestBytes: 64 * 1024,
});
const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('GAUSSIAN_MANIFEST_INVALID');
  return value as Record<string, unknown>;
};
const finite = (value: unknown, low: number, high: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error('GAUSSIAN_TRANSFORM_INVALID');
  return value;
};
const vector = (value: unknown, low = -1000, high = 1000): GaussianVec3 => {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('GAUSSIAN_TRANSFORM_INVALID');
  return [finite(value[0], low, high), finite(value[1], low, high), finite(value[2], low, high)];
};
export function safeGaussianPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\\:\x00-\x1f\x7f?#]/.test(value) || /%(?:2e|2f|5c|00)/i.test(value)) throw new Error('GAUSSIAN_PATH_REJECTED');
  if (value.split('/').some(p => !p || p === '.' || p === '..' || p.length > 120 || /[. ]$/.test(p))) throw new Error('GAUSSIAN_PATH_REJECTED');
  return value;
}
function bounds(value: unknown): GaussianBounds {
  const b = record(value, ['min', 'max']), min = vector(b.min, -20, 20), max = vector(b.max, -20, 20);
  if (min.some((v, i) => v >= max[i]!)) throw new Error('GAUSSIAN_BOUNDS_INVALID');
  return { min, max };
}
const includes = (outer: GaussianBounds, inner: GaussianBounds) => outer.min.every((v, i) => v <= inner.min[i]! && outer.max[i]! >= inner.max[i]!);
export function validateGaussianManifest(value: unknown): GaussianAvatarManifest {
  const m = record(value, ['schemaVersion','kind','name','splat','proxy','preview','coordinates','normalization','faceAnchor','faceBounds','bodyBounds','framingBounds','placement']);
  if (m.schemaVersion !== 1 || m.kind !== 'entaku-gaussian-avatar') throw new Error('GAUSSIAN_SCHEMA_UNSUPPORTED');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80 || /[\x00-\x1f\x7f]/.test(m.name)) throw new Error('GAUSSIAN_NAME_INVALID');
  const splat = safeGaussianPath(m.splat);
  if (!/\.(spz|ply)$/i.test(splat)) throw new Error('GAUSSIAN_FORMAT_UNSUPPORTED');
  const proxy = m.proxy === undefined ? undefined : safeGaussianPath(m.proxy), preview = m.preview === undefined ? undefined : safeGaussianPath(m.preview);
  if (proxy && !/\.glb$/i.test(proxy)) throw new Error('GAUSSIAN_PROXY_INVALID');
  if (preview && !/\.png$/i.test(preview)) throw new Error('GAUSSIAN_PREVIEW_INVALID');
  if (new Set(['manifest.json', splat, proxy, preview].filter(v => v !== undefined)).size !== 2 + Number(proxy !== undefined) + Number(preview !== undefined)) throw new Error('GAUSSIAN_REFERENCE_INVALID');
  const c = record(m.coordinates, ['units','up','forward']);
  const axes = ['+X','-X','+Y','-Y','+Z','-Z'];
  if (!['m','cm','mm'].includes(c.units as string) || !axes.includes(c.up as string) || !axes.includes(c.forward as string) || String(c.up).slice(1) === String(c.forward).slice(1)) throw new Error('GAUSSIAN_COORDINATES_INVALID');
  const n = record(m.normalization, ['scale','rotation','translation']);
  const normalization = { scale: finite(n.scale, .000001, 1000000), rotation: vector(n.rotation, -Math.PI * 2, Math.PI * 2), translation: vector(n.translation) };
  const faceAnchor = vector(m.faceAnchor, -20, 20), faceBounds = bounds(m.faceBounds), bodyBounds = bounds(m.bodyBounds), framingBounds = bounds(m.framingBounds);
  if (!includes(bodyBounds, faceBounds) || !includes(framingBounds, faceBounds) || faceAnchor.some((v, i) => v < faceBounds.min[i]! || v > faceBounds.max[i]!)) throw new Error('GAUSSIAN_FACE_OUTSIDE_BOUNDS');
  if (bodyBounds.max[1] - bodyBounds.min[1] > 4 || bodyBounds.max[0] - bodyBounds.min[0] > 2.8 || bodyBounds.max[2] - bodyBounds.min[2] > 2.8) throw new Error('GAUSSIAN_BOUNDS_TOO_LARGE');
  let placement: GaussianAvatarManifest['placement'];
  if(m.placement!==undefined){const p=record(m.placement,['scale','offsetX','offsetY','offsetZ','yawRad']);placement={scale:finite(p.scale,.25,3),offsetX:finite(p.offsetX,-.5,.5),offsetY:finite(p.offsetY,-.5,.5),offsetZ:finite(p.offsetZ,-.5,.5),yawRad:finite(p.yawRad,-Math.PI*2,Math.PI*2)};}
  return { schemaVersion: 1, kind: 'entaku-gaussian-avatar', name: m.name.trim(), splat,
    ...(proxy ? { proxy } : {}), ...(preview ? { preview } : {}),
    coordinates: { units: c.units as 'm'|'cm'|'mm', up: c.up as GaussianAxis, forward: c.forward as GaussianAxis }, normalization,
    faceAnchor, faceBounds, bodyBounds, framingBounds, ...(placement?{placement}:{}) };
}
export function validateGaussianProfile(value: unknown): GaussianAvatarProfile {
  const p = record(value, ['kind','userId','assetId','manifest','scale','offsetX','offsetY','offsetZ','yawRad']);
  if (p.kind !== 'gaussian' || typeof p.userId !== 'string' || !/^\d{1,20}$/.test(p.userId) || typeof p.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(p.assetId)) throw new Error('INVALID_AVATAR_PROFILE');
  const clean: GaussianAvatarProfile = { kind: 'gaussian', userId: p.userId, assetId: p.assetId, manifest: validateGaussianManifest(p.manifest),
    scale: finite(p.scale, .25, 3), offsetX: finite(p.offsetX, -.5, .5), offsetY: finite(p.offsetY, -.5, .5),
    offsetZ: finite(p.offsetZ ?? 0, -.5, .5), yawRad: finite(p.yawRad ?? 0, -Math.PI * 2, Math.PI * 2) };
  const b = gaussianBounds(clean, clean.manifest.bodyBounds);
  if (2 * (Math.max(-b.left, b.right) + Math.abs(clean.offsetX)) > 2.8 + 1e-9) throw new Error('AVATAR_TOO_WIDE');
  if (b.top - b.bottom > 4 || 1.25 + clean.offsetY + b.top > 3) throw new Error('AVATAR_TOO_TALL');
  return clean;
}
/** Conservative projection in the seat's local XY plane, rotated around face anchor. */
export function gaussianBounds(profile: GaussianAvatarProfile, box = profile.manifest.bodyBounds) {
  const a = profile.manifest.faceAnchor, c = Math.cos(profile.yawRad), s = Math.sin(profile.yawRad), xs: number[] = [], zs: number[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const z of [box.min[2], box.max[2]]) {
    xs.push(((x-a[0])*c + (z-a[2])*s) * profile.scale);
    zs.push((-(x-a[0])*s + (z-a[2])*c) * profile.scale);
  }
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: (box.min[1]-a[1])*profile.scale,
    top: (box.max[1]-a[1])*profile.scale, front: Math.max(...zs), back: Math.min(...zs) };
}
export function gaussianFaceSize(profile: GaussianAvatarProfile) {
  const b = gaussianBounds(profile, profile.manifest.faceBounds);
  return { halfWidth: Math.max(-b.left,b.right), halfHeight: Math.max(-b.bottom,b.top) };
}
export interface GaussianSettings { lodSplatCount: number }
export const DEFAULT_GAUSSIAN_SETTINGS: GaussianSettings = { lodSplatCount: 500_000 };
export function validateGaussianSettings(value: unknown = DEFAULT_GAUSSIAN_SETTINGS): GaussianSettings {
  const v = record(value, ['lodSplatCount']), n = finite(v.lodSplatCount, 1000, GAUSSIAN_LIMITS.activeSplats);
  if (!Number.isSafeInteger(n)) throw new Error('GAUSSIAN_BUDGET_INVALID');
  return { lodSplatCount: n };
}
