export interface QualitySettings {
 shadows:'off'|'soft';shadowSize:512|1024|2048;shadowLights:1|2|4;
 ao:'off'|'gtao';aoStrength:number;aoRadius:number;
 reflections:boolean;reflectionOpacity:number;effectsScale:.5|.75|1;fxaa:boolean;
 nameplates:'white'|'blue';
 msaa:0|4|8;renderScale:1|1.5|2;
 gi:'off'|'ssgi';giStrength:number;giRadius:number;
}
export const DEFAULT_QUALITY:QualitySettings={shadows:'soft',shadowSize:1024,shadowLights:2,ao:'off',aoStrength:.8,aoRadius:.35,reflections:false,reflectionOpacity:.18,effectsScale:.5,fxaa:false,nameplates:'white',msaa:4,renderScale:1,gi:'off',giStrength:.6,giRadius:1.5};
export function validateQuality(value:unknown):QualitySettings {
 if(value===undefined)return {...DEFAULT_QUALITY};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STUDIO_QUALITY_INVALID');
 const q=value as Record<string,unknown>;
 if(Object.keys(q).some(k=>!Object.hasOwn(DEFAULT_QUALITY,k)))throw new Error('STUDIO_QUALITY_INVALID');
 const v={...DEFAULT_QUALITY,...q} as QualitySettings;
 if(![0,4,8].includes(v.msaa)||![1,1.5,2].includes(v.renderScale)||!['off','ssgi'].includes(v.gi)||
  typeof v.giStrength!=='number'||!Number.isFinite(v.giStrength)||v.giStrength<0||v.giStrength>2||
  typeof v.giRadius!=='number'||!Number.isFinite(v.giRadius)||v.giRadius<.1||v.giRadius>5||
  !['off','soft'].includes(v.shadows)||![512,1024,2048].includes(v.shadowSize)||![1,2,4].includes(v.shadowLights)||!['off','gtao'].includes(v.ao)||
  ![.5,.75,1].includes(v.effectsScale)||typeof v.reflections!=='boolean'||typeof v.fxaa!=='boolean'||!['white','blue'].includes(v.nameplates)||
  typeof v.aoStrength!=='number'||!Number.isFinite(v.aoStrength)||v.aoStrength<0||v.aoStrength>2||
  typeof v.aoRadius!=='number'||!Number.isFinite(v.aoRadius)||v.aoRadius<.02||v.aoRadius>2||
  typeof v.reflectionOpacity!=='number'||!Number.isFinite(v.reflectionOpacity)||v.reflectionOpacity<0||v.reflectionOpacity>1)throw new Error('STUDIO_QUALITY_INVALID');
 return v;
}
export function hasScreenEffects(q:QualitySettings):boolean{return q.msaa>0||q.ao==='gtao'||q.reflections||q.fxaa||q.gi==='ssgi';}
