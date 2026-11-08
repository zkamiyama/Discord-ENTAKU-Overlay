/** Exposure multiplies linear scene radiance before Three.js AgX. No light-unit conversion. */
export interface ExposureSettings {
  mode: 'auto' | 'manual';
  compensationEV: number;
  manualExposure: number;
  lighting: 'auto' | 'studio' | 'combined';
}
export const MIN_EXPOSURE = 2 ** -20;
export const MAX_EXPOSURE = 32;
export const DEFAULT_EXPOSURE: ExposureSettings = {mode:'auto',compensationEV:0,manualExposure:1,lighting:'auto'};
/** User-provided comparison recipe for the attached Blender export, not a universal glTF conversion. */
export const BLENDER_REFERENCE_EXPOSURE = 2 ** .8 / 683;
export function validateExposure(value: unknown): ExposureSettings {
  if(value===undefined)return {...DEFAULT_EXPOSURE};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STUDIO_EXPOSURE_INVALID');
  const e=value as Record<string,unknown>;
  if(Object.keys(e).some(k=>!['mode','compensationEV','manualExposure','lighting'].includes(k))||
    !['auto','manual'].includes(String(e.mode))||!['auto','studio','combined'].includes(String(e.lighting))||
    typeof e.compensationEV!=='number'||!Number.isFinite(e.compensationEV)||Math.abs(e.compensationEV)>6||
    typeof e.manualExposure!=='number'||!Number.isFinite(e.manualExposure)||e.manualExposure<MIN_EXPOSURE||e.manualExposure>MAX_EXPOSURE)throw new Error('STUDIO_EXPOSURE_INVALID');
  return {mode:e.mode as ExposureSettings['mode'],compensationEV:e.compensationEV,manualExposure:e.manualExposure,lighting:e.lighting as ExposureSettings['lighting']};
}
export function clampExposure(value:number):number{return Math.max(MIN_EXPOSURE,Math.min(MAX_EXPOSURE,value));}
/** Ignore clear alpha, trim dark/bright tails, and measure in linear (not screen) space. */
export function meterExposure(rgba:ArrayLike<number>):number|null {
  const luminances:number[]=[];
  for(let i=0;i+3<rgba.length;i+=4){
    if(rgba[i+3]!<.5)continue;
    const y=.2126*rgba[i]!+.7152*rgba[i+1]!+.0722*rgba[i+2]!;
    if(Number.isFinite(y)&&y>1e-7)luminances.push(y);
    else if(y===Infinity)luminances.push(65504);
  }
  if(luminances.length<8)return null;
  luminances.sort((a,b)=>a-b);
  const start=Math.floor(luminances.length*.10),end=Math.max(start+1,Math.ceil(luminances.length*.90));
  let logSum=0;for(let i=start;i<end;i++)logSum+=Math.log2(Math.max(1e-7,luminances[i]!));
  const mean=2**(logSum/(end-start)),p90=luminances[end-1]!;
  return clampExposure(Math.min(.18/mean,4/Math.max(p90,1e-7)));
}
/** Smooth in EV, with a faster response to excessive brightness and bounded motion. */
export function adaptExposure(current:number,target:number,seconds:number):number {
  if(seconds<=0||current===target)return clampExposure(current);
  const a=Math.log2(clampExposure(current)),b=Math.log2(clampExposure(target));
  const dt=Math.max(0,Math.min(.1,seconds)),rate=b<a?4:1;
  const step=Math.max(-rate*dt,Math.min(rate*dt,(b-a)*(1-Math.exp(-dt/(b<a?.25:1.2)))));
  return clampExposure(2**(a+step));
}
export function useFallbackLights(settings:ExposureSettings,authoredLights:number):boolean {
  return settings.lighting==='combined'||(settings.lighting==='auto'&&authoredLights===0);
}
