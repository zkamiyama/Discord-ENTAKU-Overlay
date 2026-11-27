import type {createDistanceField} from '../../assets/alpha-distance.ts';
type Field=ReturnType<typeof createDistanceField>;
type WorkerHandle=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
interface FieldJob {
 alpha:Uint8Array;width:number;height:number;spread:number;
 resolve:(field:Field)=>void;reject:(error:unknown)=>void;
 signal?:AbortSignal;cancel:()=>void;
}

/** One reusable worker per page, bounded admission, and cancellation owned by
 * the avatar/editor that requested the field. Obsolete drafts leave the queue
 * immediately instead of retaining image buffers in an unbounded promise chain.
 */
export class AlphaFieldQueue {
 private readonly waiting:FieldJob[]=[];
 private active?:FieldJob;
 private worker?:WorkerHandle;
 private timer?:ReturnType<typeof setTimeout>;
 private disposed=false;
 constructor(
  private readonly createWorker:()=>WorkerHandle=()=>new Worker('/static/avatar-field.js',{type:'module'}),
  private readonly capacity=64,
  private readonly timeoutMs=15_000,
 ){}
 get size():number{return this.waiting.length+(this.active?1:0);}

 run(alpha:Uint8Array,width:number,height:number,spread=16,signal?:AbortSignal):Promise<Field> {
  if(signal?.aborted)return Promise.reject(signal.reason);
  if(this.disposed)return Promise.reject(new Error('ALPHA_FIELD_DISPOSED'));
  if(this.size>=this.capacity)return Promise.reject(new Error('ALPHA_FIELD_BUSY'));
  return new Promise((resolve,reject)=>{
   const job:FieldJob={alpha,width,height,spread,resolve,reject,signal,cancel:()=>this.cancel(job)};
   signal?.addEventListener('abort',job.cancel,{once:true});
   this.waiting.push(job);this.pump();
  });
 }
 private cancel(job:FieldJob):void {
  if(job===this.active){this.finish(undefined,job.signal?.reason??new Error('ALPHA_FIELD_CANCELLED'),true);return;}
  const index=this.waiting.indexOf(job);
  if(index<0)return;
  this.waiting.splice(index,1);job.signal?.removeEventListener('abort',job.cancel);
  job.reject(job.signal?.reason??new Error('ALPHA_FIELD_CANCELLED'));
 }
 private stopWorker():void {
  const worker=this.worker;this.worker=undefined;
  if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();}
 }
 private finish(field:Field|undefined,error?:unknown,retire=false):void {
  const job=this.active;if(!job)return;
  this.active=undefined;clearTimeout(this.timer);this.timer=undefined;
  job.signal?.removeEventListener('abort',job.cancel);
  if(retire)this.stopWorker();
  if(field)job.resolve(field);else job.reject(error??new Error('ALPHA_FIELD_FAILED'));
  this.pump();
 }
 private pump():void {
  if(this.disposed||this.active)return;
  const job=this.waiting.shift();if(!job)return;
  this.active=job;
  try{
   if(!this.worker){
    const worker=this.createWorker();this.worker=worker;
    worker.onmessage=event=>{
     if(this.worker!==worker||!this.active)return;
     const field=event.data?.field as Field|undefined,current=this.active;
     if(!field||!(field.data instanceof Uint8Array)||field.width!==current.width||field.height!==current.height||field.spread!==current.spread||field.data.length!==current.width*current.height){
      this.finish(undefined,new Error('ALPHA_FIELD_FAILED'),true);return;
     }
     this.finish(field);
    };
    worker.onerror=worker.onmessageerror=()=>{
     if(this.worker!==worker)return;
     if(this.active)this.finish(undefined,new Error('ALPHA_FIELD_FAILED'),true);
     else this.stopWorker();
    };
   }
   this.timer=setTimeout(()=>this.finish(undefined,new Error('ALPHA_FIELD_TIMEOUT'),true),this.timeoutMs);
   this.worker.postMessage({alpha:job.alpha,width:job.width,height:job.height,spread:job.spread},[job.alpha.buffer as ArrayBuffer]);
  }catch(error){this.finish(undefined,error,true);}
 }
 dispose():void {
  if(this.disposed)return;
  this.disposed=true;
  for(const job of this.waiting.splice(0)){
   job.signal?.removeEventListener('abort',job.cancel);job.reject(new Error('ALPHA_FIELD_DISPOSED'));
  }
  this.finish(undefined,new Error('ALPHA_FIELD_DISPOSED'),true);
  this.stopWorker();
 }
}

const fields=new AlphaFieldQueue();
if(typeof window!=='undefined')window.addEventListener('pagehide',event=>{if(!event.persisted)fields.dispose();});
export function alphaField(alpha:Uint8Array,width:number,height:number,spread=16,signal?:AbortSignal):Promise<Field>{
 return fields.run(alpha,width,height,spread,signal);
}
