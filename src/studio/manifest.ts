import type { Vec3 } from '../contracts/domain.ts';

/** All distances are metres in the local, right-handed Three.js stage. */
export interface StudioTransform {
  position: Vec3;
  yawDeg: number;
  scale: Vec3;
}
export type StudioObject =
  | { id: string; kind: 'model'; bundleId: string; transform: StudioTransform }
  | { id: string; kind: 'box'; size: Vec3; color: string; transform: StudioTransform }
  | { id: string; kind: 'plane'; size: readonly [number, number]; color: string; transform: StudioTransform }
  | { id: string; kind: 'point-light'; position: Vec3; color: string; intensity: number };
export interface StudioCamera {
  blockers: Array<{id:string;min:Vec3;max:Vec3}>;
  safeWide?: {position:Vec3;target:Vec3;fov:number};
}
export interface StudioScene {
  schemaVersion: 1;
  revision: number;
  tableAnchor: { position: Vec3; yawDeg: number };
  tableEnvelope: { maxStraightLength: number; overflow: 'hide-studio' | 'warn-only' };
  objects: StudioObject[];
  camera?: StudioCamera;
}
export const DEFAULT_STUDIO_SCENE: StudioScene = {
  schemaVersion: 1,
  revision: 0,
  tableAnchor: { position: [0, 0, 0], yawDeg: 0 },
  tableEnvelope: { maxStraightLength: 16, overflow: 'hide-studio' },
  objects: [],
};
export const MAX_STUDIO_OBJECTS = 64;
export const MAX_GLB_BYTES = 32 * 1024 * 1024;
export const MAX_STUDIO_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_STUDIO_UNPACKED_BYTES = 128 * 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function object(v: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(v) || Object.keys(v).some(k => !allowed.includes(k))) throw new Error('STUDIO_SCENE_INVALID');
  return v;
}
function finite(v: unknown, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error('STUDIO_SCENE_INVALID');
  return v;
}
function vec3(v: unknown, lo: number, hi: number): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw new Error('STUDIO_SCENE_INVALID');
  return [finite(v[0],lo,hi),finite(v[1],lo,hi),finite(v[2],lo,hi)];
}
function color(v: unknown): string {
  if (typeof v !== 'string' || !/^#[\da-fA-F]{6}$/.test(v)) throw new Error('STUDIO_SCENE_INVALID');
  return v.toLowerCase();
}
function id(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-zA-Z][a-zA-Z\d_-]{0,47}$/.test(v)) throw new Error('STUDIO_SCENE_INVALID');
  return v;
}
const bundleId = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[\da-f]{64}$/.test(v)) throw new Error('STUDIO_SCENE_INVALID');
  return v;
};
function transform(v: unknown): StudioTransform {
  const x = object(v, ['position','yawDeg','scale']);
  return { position: vec3(x.position,-100,100), yawDeg: finite(x.yawDeg,-360,360), scale: vec3(x.scale,0.01,20) };
}
export function validateStudioScene(value: unknown): StudioScene {
  const scene = object(value,['schemaVersion','revision','tableAnchor','tableEnvelope','objects','camera']);
  if (scene.schemaVersion !== 1) throw new Error('STUDIO_SCHEMA_UNSUPPORTED');
  const rev=finite(scene.revision,0,Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(rev)) throw new Error('STUDIO_SCENE_INVALID');
  const anchor=object(scene.tableAnchor,['position','yawDeg']);
  const envelope=object(scene.tableEnvelope,['maxStraightLength','overflow']);
  if (envelope.overflow !== 'hide-studio' && envelope.overflow !== 'warn-only') throw new Error('STUDIO_SCENE_INVALID');
  if (!Array.isArray(scene.objects) || scene.objects.length > MAX_STUDIO_OBJECTS) throw new Error('STUDIO_SCENE_INVALID');
  const objects: StudioObject[] = [];
  const ids=new Set<string>();
  for (const raw of scene.objects) {
    const o = object(raw,['id','kind','transform','bundleId','size','color','position','intensity']);
    const objectId=id(o.id);
    if (ids.has(objectId)) throw new Error('STUDIO_SCENE_INVALID');
    ids.add(objectId);
    if (o.kind === 'model') {
      object(raw,['id','kind','transform','bundleId']);
      objects.push({ id:objectId, kind:'model',bundleId:bundleId(o.bundleId),transform:transform(o.transform) });
    } else if (o.kind === 'box') {
      object(raw,['id','kind','size','color','transform']);
      objects.push({ id:objectId,kind:'box',size:vec3(o.size,0.01,60),color:color(o.color),transform:transform(o.transform) });
    } else if (o.kind === 'plane') {
      object(raw,['id','kind','size','color','transform']);
      if (!Array.isArray(o.size) || o.size.length !== 2) throw new Error('STUDIO_SCENE_INVALID');
      objects.push({ id:objectId,kind:'plane',size:[finite(o.size[0],0.01,100),finite(o.size[1],0.01,100)],color:color(o.color),transform:transform(o.transform) });
    } else if (o.kind === 'point-light') {
      object(raw,['id','kind','position','color','intensity']);
      objects.push({ id:objectId,kind:'point-light',position:vec3(o.position,-100,100),color:color(o.color),intensity:finite(o.intensity,0,100) });
    } else throw new Error('STUDIO_SCENE_INVALID');
  }
  return {
    schemaVersion:1, revision:rev,
    tableAnchor:{ position:vec3(anchor.position,-100,100), yawDeg:finite(anchor.yawDeg,-360,360) },
    tableEnvelope:{maxStraightLength:finite(envelope.maxStraightLength,0,100),overflow:envelope.overflow},
    objects,
    ...(scene.camera===undefined?{}:{camera:validateStudioCamera(scene.camera)}),
  };
}

/** URLs are never fetched implicitly. Local paths are safe, relocatable bundle members. */
export function safeStudioPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !value || value.startsWith('/') || value.includes('\\')) throw new Error('STUDIO_PATH_REJECTED');
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { throw new Error('STUDIO_PATH_REJECTED'); }
  if (decoded !== value && /%2f|%5c/i.test(value)) throw new Error('STUDIO_PATH_REJECTED');
  if (/[\x00-\x1f\x7f]/.test(decoded) || decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') || decoded.includes(':')) throw new Error('STUDIO_PATH_REJECTED');
  const parts=decoded.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.length > 120)) throw new Error('STUDIO_PATH_REJECTED');
  return parts.join('/');
}

export function studioAssetUrlAllowed(value: string): boolean {
  return value.startsWith('data:') && /^data:(?:image\/(?:png|jpeg|webp|ktx2)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(value);
}

function validateStudioCamera(value:unknown):StudioCamera{
  const c=object(value,['blockers','safeWide']);
  if(!Array.isArray(c.blockers)||c.blockers.length>64)throw new Error('STUDIO_CAMERA_INVALID');
  const blockers=c.blockers.map(raw=>{
    const b=object(raw,['id','min','max']);const min=vec3(b.min,-200,200),max=vec3(b.max,-200,200);
    if(min.some((v,i)=>v>=max[i]!))throw new Error('STUDIO_CAMERA_INVALID');
    return {id:id(b.id),min,max};
  });
  if(new Set(blockers.map(b=>b.id)).size!==blockers.length)throw new Error('STUDIO_CAMERA_INVALID');
  if(c.safeWide===undefined)return {blockers};
  const wide=object(c.safeWide,['position','target','fov']);const position=vec3(wide.position,-200,200),target=vec3(wide.target,-200,200);
  if(Math.hypot(...position.map((v,i)=>v-target[i]!))<.1)throw new Error('STUDIO_CAMERA_INVALID');
  return {blockers,safeWide:{position,target,fov:finite(wide.fov,20,80)}};
}
