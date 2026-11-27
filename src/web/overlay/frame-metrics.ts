import type {FramePerformance} from '../../contracts/diagnostics.ts';

/** Fixed-size sample window; sorting happens only on the diagnostic path. */
export class SampleWindow{
 private readonly values:Float64Array;
 private cursor=0;
 private count=0;
 constructor(capacity:number){
  if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('INVALID_SAMPLE_CAPACITY');
  this.values=new Float64Array(capacity);
 }
 get size():number{return this.count;}
 push(value:number):void{
  if(!Number.isFinite(value)||value<0)return;
  this.values[this.cursor]=value;this.cursor=(this.cursor+1)%this.values.length;
  this.count=Math.min(this.count+1,this.values.length);
 }
 clear():void{this.cursor=0;this.count=0;}
 summary(){
  const sorted=this.values.slice(0,this.count).sort();
  const percentile=(q:number)=>sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]??0;
  return {count:this.count,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)};
 }
}
export class FrameMetrics{
 private readonly intervals=new SampleWindow(240);
 private readonly prepare=new SampleWindow(240);
 private readonly submit=new SampleWindow(240);
 readonly gpu=new SampleWindow(32);
 record(intervalMs:number,prepareMs:number,submitMs:number):void{
  this.intervals.push(intervalMs);this.prepare.push(prepareMs);this.submit.push(submitMs);
 }
 report():FramePerformance|undefined{
  if(!this.intervals.size)return undefined;
  const frame=this.intervals.summary(),gpu=this.gpu.summary();
  return {frameSamples:frame.count,frameP50Ms:frame.p50,frameP95Ms:frame.p95,frameP99Ms:frame.p99,
   prepareP95Ms:this.prepare.summary().p95,submitP95Ms:this.submit.summary().p95,
   ...(gpu.count?{gpuP95Ms:gpu.p95,gpuSamples:gpu.count}:{})};
 }
}
interface TimerExtension {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}
/** WebGL2 asynchronous GPU timer. Do not block on readback or pretend the CPU
 * submission time is GPU time. At most four outstanding sampled queries. */
export class GpuFrameSampler{
 private extension:TimerExtension|null;
 private pending:WebGLQuery[]=[];
 private active?:WebGLQuery;
 private next=0;
 constructor(private readonly gl:WebGL2RenderingContext,private readonly samples:SampleWindow){
  this.extension=gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension|null;
 }
 begin(now:number):void{
  const ext=this.extension,gl=this.gl;
  if(!ext||gl.isContextLost())return;
  try{
   if(gl.getParameter(ext.GPU_DISJOINT_EXT)){
    for(const q of this.pending)gl.deleteQuery(q);
    this.pending=[];this.samples.clear();return;
   }
   const remaining:WebGLQuery[]=[];
   for(const q of this.pending){
    if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){
     this.samples.push(Number(gl.getQueryParameter(q,gl.QUERY_RESULT))/1e6);gl.deleteQuery(q);
    }else remaining.push(q);
   }
   this.pending=remaining;
   if(this.active||now<this.next||this.pending.length>=4||gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return;
   const query=gl.createQuery();if(!query)return;
   gl.beginQuery(ext.TIME_ELAPSED_EXT,query);this.active=query;this.next=now+250;
  }catch{this.dispose();}
 }
 end():void{
  const ext=this.extension,query=this.active;this.active=undefined;
  if(!ext||!query)return;
  if(this.gl.isContextLost())return;
  try{this.gl.endQuery(ext.TIME_ELAPSED_EXT);this.pending.push(query);}
  catch{this.gl.deleteQuery(query);this.dispose();}
 }
 dispose():void{
  if(this.active)this.end();
  if(!this.gl.isContextLost())for(const query of this.pending)this.gl.deleteQuery(query);
  this.pending=[];this.active=undefined;this.extension=null;
 }
}
