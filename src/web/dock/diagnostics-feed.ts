import type {RuntimeDiagnostics} from '../../contracts/diagnostics.ts';
import type {StudioClient} from '../shared/client.ts';
import {pollVisible} from './visible-poll.ts';
const feeds=new WeakMap<StudioClient,DiagnosticsFeed>();
/** Exposure and diagnostics share one in-flight request and one polling timer. */
export class DiagnosticsFeed {
 private pending:Promise<RuntimeDiagnostics>|null=null;
 private listeners=new Set<(value:RuntimeDiagnostics)=>void>();
 private stop?:()=>void;
 private constructor(private client:StudioClient){}
 static for(client:StudioClient):DiagnosticsFeed {
  let feed=feeds.get(client);if(!feed){feed=new DiagnosticsFeed(client);feeds.set(client,feed);}return feed;
 }
 subscribe(listener:(value:RuntimeDiagnostics)=>void):()=>void {
  this.listeners.add(listener);
  this.stop??=pollVisible(async()=>{if(this.client.connected)await this.refresh().catch(()=>{});},1000);
  return ()=>{this.listeners.delete(listener);if(!this.listeners.size){this.stop?.();this.stop=undefined;}};
 }
 refresh():Promise<RuntimeDiagnostics>{
  if(this.pending)return this.pending;
  this.pending=this.client.localFetch('/api/diagnostics').then(r=>r.json() as Promise<RuntimeDiagnostics>).then(data=>{
   for(const listener of this.listeners)listener(data);return data;
  }).finally(()=>{this.pending=null;});
  return this.pending;
 }
}
