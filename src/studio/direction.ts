/** Camera settings in seconds/metres/degrees. Timing is shared by tracker and director. */
export interface DirectionSettings {
 manualReturnSeconds:number;portraitFov:number;wideHeightRatio:number;nearClip:number;splitEnabled:boolean;
 startGraceSeconds:number;endConfirmSeconds:number;endGraceSeconds:number;leadershipWindowSeconds:number;
}
export const DEFAULT_DIRECTION:DirectionSettings={manualReturnSeconds:10,portraitFov:22,wideHeightRatio:.3,nearClip:.15,splitEnabled:true,
 startGraceSeconds:1.5,endConfirmSeconds:2.5,endGraceSeconds:5,leadershipWindowSeconds:10};
export const DIRECTION_LIMITS={manualReturnSeconds:[1,120],portraitFov:[16,35],wideHeightRatio:[.15,1],nearClip:[.02,1],
 startGraceSeconds:[.5,10],endConfirmSeconds:[0,10],endGraceSeconds:[0,15],leadershipWindowSeconds:[3,30]} as const;
export function validateDirection(value:unknown):DirectionSettings {
 if(value===undefined)return {...DEFAULT_DIRECTION};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STUDIO_DIRECTION_INVALID');
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).some(k=>!Object.hasOwn(DEFAULT_DIRECTION,k)))throw new Error('STUDIO_DIRECTION_INVALID');
 const d={...DEFAULT_DIRECTION,...raw} as DirectionSettings;
 for(const key of Object.keys(DIRECTION_LIMITS) as Array<keyof typeof DIRECTION_LIMITS>){
  const [lo,hi]=DIRECTION_LIMITS[key];if(typeof d[key]!=='number'||!Number.isFinite(d[key])||d[key]<lo||d[key]>hi)throw new Error('STUDIO_DIRECTION_INVALID');
 }
 if(typeof d.splitEnabled!=='boolean')throw new Error('STUDIO_DIRECTION_INVALID');
 return d;
}
export function directionTiming(d:DirectionSettings=DEFAULT_DIRECTION){return {
 startGraceMs:d.startGraceSeconds*1000,endConfirmMs:d.endConfirmSeconds*1000,
 endGraceMs:d.endGraceSeconds*1000,leadershipWindowMs:d.leadershipWindowSeconds*1000,
 // Qualification must not make a shorter configured onset ineffective.
 qualifyMs:Math.min(1000,d.startGraceSeconds*1000),minShotMs:d.startGraceSeconds*1000,
};}
