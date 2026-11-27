import type {RenderReport,FramePerformance} from '../contracts/diagnostics.ts';
import {RENDER_STATUSES,type RenderStatus} from '../contracts/diagnostics.ts';
const allowed=new Set<string>(RENDER_STATUSES);
const finite=(v:unknown,min=0,max=1e9):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<max;
const integer=(v:unknown,min:number,max:number):v is number=>finite(v,min,max+1)&&Number.isSafeInteger(v);
function performanceFields(p:Record<string,unknown>):Partial<FramePerformance>{
 const keys=['frameP50Ms','frameP95Ms','frameP99Ms','prepareP95Ms','submitP95Ms'] as const;
 if(!integer(p.frameSamples,1,240)||!keys.every(key=>finite(p[key]))||
    Number(p.frameP50Ms)>Number(p.frameP95Ms)||Number(p.frameP95Ms)>Number(p.frameP99Ms))return {};
 return {frameSamples:p.frameSamples,frameP50Ms:p.frameP50Ms as number,frameP95Ms:p.frameP95Ms as number,frameP99Ms:p.frameP99Ms as number,
  prepareP95Ms:p.prepareP95Ms as number,submitP95Ms:p.submitP95Ms as number,
  ...(finite(p.gpuP95Ms)&&integer(p.gpuSamples,1,32)?{gpuP95Ms:p.gpuP95Ms,gpuSamples:p.gpuSamples}:{})};
}
export function parseRenderReport(p:Record<string,unknown>,updatedAtMs:number):RenderReport {
 if(typeof p.status!=='string'||!allowed.has(p.status)||!finite(p.frameMs)||!finite(p.drawCalls)||!finite(p.triangles))throw Error('INVALID_RENDER_REPORT');
 const exposure=finite(p.exposure,Number.MIN_VALUE,32+Number.EPSILON*32)&&['AUTO','MANUAL','EMPTY_METER','HDR_UNAVAILABLE','METER_FAILED'].includes(String(p.exposureStatus))&&integer(p.authoredLights,0,10000)&&typeof p.fallbackLights==='boolean'
  ?{exposure:p.exposure,exposureStatus:String(p.exposureStatus),authoredLights:p.authoredLights,fallbackLights:p.fallbackLights}:{};
 const quality=['DIRECT','EFFECTS','EFFECTS_UNAVAILABLE','EFFECTS_FAILED'].includes(String(p.qualityStatus))&&integer(p.shadowLights,0,8)
  ?{qualityStatus:String(p.qualityStatus),shadowLights:p.shadowLights}:{};
 return {status:p.status as RenderStatus,frameMs:p.frameMs,drawCalls:p.drawCalls,triangles:p.triangles,updatedAtMs,...exposure,...quality,
  ...(typeof p.msaaSamples==='number'&&[0,2,4,8].includes(p.msaaSamples)?{msaaSamples:p.msaaSamples}:{}),...performanceFields(p)};
}
