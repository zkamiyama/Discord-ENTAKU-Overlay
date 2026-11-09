import {Vector3} from 'three';
import type {CameraPose,Vec3} from '../contracts/domain.ts';
export interface PostSettings {
 enabled:boolean;excludeAvatars:boolean;
 saturation:number;contrast:number;
 bloom:boolean;bloomThreshold:number;bloomStrength:number;bloomRadius:number;
 dof:boolean;focusMode:'subject'|'behind'|'manual';focusOffset:number;focusDistance:number;focusRange:number;aperture:number;maxBlur:number;
 speechGlowScale:number;
}
/** Neutral migration: enabling a new version must not silently grade an existing show. */
export const DEFAULT_POST:PostSettings={enabled:true,excludeAvatars:true,saturation:1,contrast:1,bloom:false,bloomThreshold:.85,bloomStrength:.15,bloomRadius:.25,dof:false,focusMode:'behind',focusOffset:.35,focusDistance:6,focusRange:.5,aperture:.0015,maxBlur:3,speechGlowScale:4};
export const NATURAL_POST:PostSettings={...DEFAULT_POST,saturation:1.06,contrast:1.04,bloom:true,dof:true};
export function validatePost(value:unknown):PostSettings {
 if(value===undefined)return {...DEFAULT_POST};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STUDIO_POST_INVALID');
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).some(k=>!Object.hasOwn(DEFAULT_POST,k)))throw new Error('STUDIO_POST_INVALID');
 const p={...DEFAULT_POST,...raw} as PostSettings;
 for(const k of ['enabled','excludeAvatars','bloom','dof'] as const)if(typeof p[k]!=='boolean')throw new Error('STUDIO_POST_INVALID');
 if(!['subject','behind','manual'].includes(p.focusMode))throw new Error('STUDIO_POST_INVALID');
 const limits:Partial<Record<keyof PostSettings,readonly [number,number]>>={saturation:[0,2],contrast:[.5,1.5],bloomThreshold:[0,1.5],bloomStrength:[0,2],bloomRadius:[0,1],focusOffset:[0,10],focusDistance:[.1,200],focusRange:[0,20],aperture:[0,.03],maxBlur:[0,16],speechGlowScale:[1,8]};
 for(const [key,[lo,hi]]of Object.entries(limits)){const n=p[key as keyof PostSettings];if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)throw new Error('STUDIO_POST_INVALID');}
 return p;
}
export function hasPostEffects(p:PostSettings):boolean{return p.enabled&&(Math.abs(p.saturation-1)>.00001||Math.abs(p.contrast-1)>.00001||(p.bloom&&p.bloomStrength>0)||(p.dof&&p.maxBlur>0&&p.aperture>0));}
export interface FocusBand {distance:number;range:number}
/** Bokeh depth is view-axis depth, not Euclidean distance. Cover both subjects in a TWO_SHOT. */
export function resolvePostFocus(p:PostSettings,pose:CameraPose,subjects:readonly Vec3[]):FocusBand {
 if(p.focusMode==='manual')return {distance:p.focusDistance,range:p.focusRange};
 const eye=new Vector3().fromArray(pose.position),forward=new Vector3().fromArray(pose.target).sub(eye).normalize();
 const depths=subjects.map(point=>new Vector3().fromArray(point).sub(eye).dot(forward)).filter(d=>Number.isFinite(d)&&d>.05);
 if(!depths.length)depths.push(Math.max(.1,new Vector3().fromArray(pose.target).distanceTo(eye)));
 const lo=Math.min(...depths),hi=Math.max(...depths),distance=(lo+hi)/2+(p.focusMode==='behind'?p.focusOffset:0);
 return {distance:Math.min(200,Math.max(.1,distance)),range:Math.max(p.focusRange,distance-lo,hi-distance)};
}
