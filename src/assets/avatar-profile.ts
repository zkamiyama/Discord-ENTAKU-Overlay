import type { ImageInfo } from './image.ts';
export type FaceRect = readonly [number, number, number, number];
export interface AvatarProfile {
  userId: string; assetId: string; image: ImageInfo; faceRect: FaceRect;
  scale: number; offsetX: number; offsetY: number;
  back?: {assetId:string;image:ImageInfo;faceRect:FaceRect};
  framingRect?: FaceRect;
}
export const FACE_HEIGHT = 0.28;
export const MAX_AVATAR_WIDTH = 2.8; // Session rail pitch grows to fit the widest reserved image.
export function validateProfile(input: unknown): AvatarProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_AVATAR_PROFILE');
  const p = input as AvatarProfile;
  if (typeof p.userId !== 'string' || !/^\d{1,20}$/.test(p.userId) || typeof p.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(p.assetId)) throw new Error('INVALID_AVATAR_PROFILE');
  if (!p.image || !['image/png', 'image/webp'].includes(p.image.mime) || ![p.image.width, p.image.height].every(v => Number.isInteger(v) && v >= 1 && v <= 4096)) throw new Error('INVALID_AVATAR_PROFILE');
  const r = p.faceRect;
  if (!Array.isArray(r) || r.length !== 4 || r.some(v => typeof v !== 'number' || !Number.isFinite(v)) || r[0] < 0 || r[1] < 0 || r[2] <= 0 || r[3] <= 0 || r[0] + r[2] > 1 + 1e-9 || r[1] + r[3] > 1 + 1e-9) throw new Error('INVALID_FACE_RECT');
  if (r[2] * p.image.width < 4 || r[3] * p.image.height < 4) throw new Error('FACE_RECT_TOO_SMALL');
  if (![p.scale, p.offsetX, p.offsetY].every(v => typeof v === 'number' && Number.isFinite(v)) || p.scale < .25 || p.scale > 3 || Math.abs(p.offsetX) > .5 || Math.abs(p.offsetY) > .5) throw new Error('INVALID_AVATAR_TRANSFORM');
  const clean: AvatarProfile = { userId: p.userId, assetId: p.assetId, image: { width: p.image.width, height: p.image.height, mime: p.image.mime }, faceRect: [r[0], r[1], r[2], r[3]], scale: p.scale, offsetX: p.offsetX, offsetY: p.offsetY };
  if(p.back!==undefined){
    if(!p.back||typeof p.back!=='object')throw new Error('INVALID_AVATAR_PROFILE');
    const b=validateProfile({...clean,assetId:p.back.assetId,image:p.back.image,faceRect:p.back.faceRect});
    clean.back={assetId:b.assetId,image:b.image,faceRect:b.faceRect};
  }
  if(p.framingRect!==undefined){
    const f=p.framingRect;
    if(!Array.isArray(f)||f.length!==4||f.some(v=>typeof v!=='number'||!Number.isFinite(v))||f[0]<0||f[1]<0||f[2]<=0||f[3]<=0||f[0]+f[2]>1+1e-9||f[1]+f[3]>1+1e-9)throw new Error('INVALID_FRAMING_RECT');
    // The camera crop may omit a body, never the selected face.
    if(f[0]>r[0]||f[1]>r[1]||f[0]+f[2]<r[0]+r[2]||f[1]+f[3]<r[1]+r[3])throw new Error('FRAMING_MUST_INCLUDE_FACE');
    clean.framingRect=[f[0],f[1],f[2],f[3]];
  }
  const bounds = avatarEnvelopeBounds(clean);
  if (2 * (Math.max(Math.abs(bounds.left), Math.abs(bounds.right)) + Math.abs(clean.offsetX)) > MAX_AVATAR_WIDTH + 1e-9) throw new Error('AVATAR_TOO_WIDE');
  if (bounds.top - bounds.bottom > 4 || bounds.top + 1.25 + clean.offsetY > 3) throw new Error('AVATAR_TOO_TALL');
  return clean;
}
export function avatarBounds(profile: AvatarProfile) {
  const [x, y, w, h] = profile.faceRect, fx = x + w / 2, fy = y + h / 2;
  const metersPerPixel = FACE_HEIGHT * profile.scale / (h * profile.image.height);
  return {
    metersPerPixel,
    left: -fx * profile.image.width * metersPerPixel,
    right: (1 - fx) * profile.image.width * metersPerPixel,
    top: fy * profile.image.height * metersPerPixel,
    bottom: (fy - 1) * profile.image.height * metersPerPixel,
  };
}
export function imagePointToLocal(profile: AvatarProfile, u: number, v: number): readonly [number, number] {
  const b = avatarBounds(profile);
  return [b.left + u * (b.right - b.left), b.top + v * (b.bottom - b.top)];
}

export function backProfile(profile:AvatarProfile):AvatarProfile|null{
  return profile.back?{userId:profile.userId,...profile.back,scale:profile.scale,offsetX:profile.offsetX,offsetY:profile.offsetY}:null;
}
export function avatarEnvelopeBounds(profile:AvatarProfile){
  const front=avatarBounds(profile),back=backProfile(profile);
  if(!back)return front;
  const b=avatarBounds(back);
  return {...front,left:Math.min(front.left,-b.right),right:Math.max(front.right,-b.left),top:Math.max(front.top,b.top),bottom:Math.min(front.bottom,b.bottom)};
}
export function avatarFramingBounds(profile:AvatarProfile){
  if(!profile.framingRect)return avatarEnvelopeBounds(profile);
  const [x,y,w,h]=profile.framingRect,a=imagePointToLocal(profile,x,y),b=imagePointToLocal(profile,x+w,y+h);
  return {left:a[0],right:b[0],top:a[1],bottom:b[1]};
}
export function requiredAvatarPitch(profile:AvatarProfile):number{
  const b=avatarEnvelopeBounds(profile);return 2*(Math.max(-b.left,b.right)+Math.abs(profile.offsetX))+.12;
}
