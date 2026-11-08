import type { DiagnosticEntry } from '../diagnostics/journal.ts';
export interface ReplayStatus {elapsedMs:number;durationMs:number;paused:boolean;rate:number;seeking:boolean}
export interface ReplayControl {action:'play'|'pause'|'seek'|'rate';value?:number}
export interface RenderReport {status:string;frameMs:number;drawCalls:number;triangles:number;updatedAtMs:number;exposure?:number;exposureStatus?:string;authoredLights?:number;fallbackLights?:boolean}
export interface RuntimeDiagnostics {
  version:string;runtime:string;platform:string;source:string;connection:string;errorCode?:string;
  participantCount:number;capacity:number;rssBytes:number;events:DiagnosticEntry[];
  render:RenderReport|null;
  recording:{active:boolean;eventCount:number;durationMs:number;limitReached:boolean};
  replay:ReplayStatus|null;
}
