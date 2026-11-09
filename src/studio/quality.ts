export interface QualitySettings {
 shadows:'off'|'soft';shadowSize:512|1024|2048;shadowLights:1|2|4|8;
 ao:'off'|'gtao';aoStrength:number;aoRadius:number;
 reflections:boolean;reflectionOpacity:number;effectsScale:.5|.75|1;fxaa:boolean;
 nameplates:'white'|'blue';
 msaa:0|2|4|8;renderScale:1|1.5|2;
 gi:'off'|'ssgi';giStrength:number;giRadius:number;
}
export const DEFAULT_QUALITY:QualitySettings={shadows:'soft',shadowSize:1024,shadowLights:8,ao:'gtao',aoStrength:.8,aoRadius:.35,reflections:true,reflectionOpacity:.18,effectsScale:.5,fxaa:true,nameplates:'blue',msaa:4,renderScale:1,gi:'off',giStrength:.6,giRadius:1.5};
export function validateQuality(value:unknown):QualitySettings {
 if(value===undefined)return {...DEFAULT_QUALITY};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STUDIO_QUALITY_INVALID');
 const q=value as Record<string,unknown>;
 if(Object.keys(q).some(k=>!Object.hasOwn(DEFAULT_QUALITY,k)))throw new Error('STUDIO_QUALITY_INVALID');
 const v={...DEFAULT_QUALITY,...q} as QualitySettings;
 if(![0,2,4,8].includes(v.msaa)||![1,1.5,2].includes(v.renderScale)||!['off','ssgi'].includes(v.gi)||
  typeof v.giStrength!=='number'||!Number.isFinite(v.giStrength)||v.giStrength<0||v.giStrength>2||
  typeof v.giRadius!=='number'||!Number.isFinite(v.giRadius)||v.giRadius<.1||v.giRadius>5||
  !['off','soft'].includes(v.shadows)||![512,1024,2048].includes(v.shadowSize)||![1,2,4,8].includes(v.shadowLights)||!['off','gtao'].includes(v.ao)||
  ![.5,.75,1].includes(v.effectsScale)||typeof v.reflections!=='boolean'||typeof v.fxaa!=='boolean'||!['white','blue'].includes(v.nameplates)||
  typeof v.aoStrength!=='number'||!Number.isFinite(v.aoStrength)||v.aoStrength<0||v.aoStrength>2||
  typeof v.aoRadius!=='number'||!Number.isFinite(v.aoRadius)||v.aoRadius<.02||v.aoRadius>2||
  typeof v.reflectionOpacity!=='number'||!Number.isFinite(v.reflectionOpacity)||v.reflectionOpacity<0||v.reflectionOpacity>1)throw new Error('STUDIO_QUALITY_INVALID');
 return v;
}
export function hasScreenEffects(q:QualitySettings):boolean{return q.msaa>0||q.ao==='gtao'||q.reflections||q.fxaa||q.gi==='ssgi';}
/** Some drivers expose 4x but no 2x for RGBA16F. Never silently claim 2x. */
export function effectiveSamples(requested:number,available:readonly number[],max:number):number {
 if(requested===0)return 0;
 const usable=available.filter(n=>Number.isInteger(n)&&n>0&&n<=max).sort((a,b)=>b-a);
 return usable.find(n=>n<=requested)??usable.at(-1)??0;
}
