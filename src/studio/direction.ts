/** Camera presentation settings; seconds/metres/degrees, independent from studio geometry. */
export interface DirectionSettings {manualReturnSeconds:number;portraitFov:number;wideHeightRatio:number;nearClip:number;splitEnabled:boolean}
export const DEFAULT_DIRECTION:DirectionSettings={manualReturnSeconds:10,portraitFov:22,wideHeightRatio:.3,nearClip:.15,splitEnabled:false};
export function validateDirection(value:unknown):DirectionSettings {
 if(value===undefined)return {...DEFAULT_DIRECTION};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STUDIO_DIRECTION_INVALID');
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).some(k=>!Object.hasOwn(DEFAULT_DIRECTION,k)))throw new Error('STUDIO_DIRECTION_INVALID');
 const d={...DEFAULT_DIRECTION,...raw} as DirectionSettings;
 for(const [key,lo,hi]of [['manualReturnSeconds',1,120],['portraitFov',16,35],['wideHeightRatio',.15,1],['nearClip',.02,1]] as const){
  if(!Number.isFinite(d[key])||typeof d[key]!=='number'||d[key]<lo||d[key]>hi)throw new Error('STUDIO_DIRECTION_INVALID');
 }
 if(typeof d.splitEnabled!=='boolean')throw new Error('STUDIO_DIRECTION_INVALID');
 return d;
}
