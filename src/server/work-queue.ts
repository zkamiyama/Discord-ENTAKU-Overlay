interface WaitingWork {
 run():Promise<void>;
 cancel():void;
 detach():void;
}

/** Bounded single writer. Cancellation removes waiting work immediately; once
 * started, a mutation owns its transaction until it commits or rolls back. */
export class WorkQueue {
 private readonly waiting:WaitingWork[]=[];
 private running=false;
 private closed=false;
 private drained:Promise<void>|undefined;
 private finishClose:(()=>void)|undefined;
 constructor(private readonly limit:number){
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('INVALID_QUEUE_LIMIT');
 }
 get size():number{return this.waiting.length+Number(this.running);}
 tryRun<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>|null {
  if(this.closed||this.size>=this.limit)return null;
  if(signal?.aborted)return Promise.reject(new Error('WORK_CANCELLED'));
  const result=new Promise<T>((resolve,reject)=>{
   const abort=()=>{
    const index=this.waiting.indexOf(entry);
    if(index<0)return;
    this.waiting.splice(index,1);entry.cancel();
   };
   const entry:WaitingWork={
    run:async()=>{
     let value:T;
     try{value=await work();}catch(error){this.complete();reject(error);return;}
     this.complete();resolve(value);
    },
    cancel:()=>{entry.detach();reject(new Error('WORK_CANCELLED'));},
    detach:()=>signal?.removeEventListener('abort',abort),
   };
   this.waiting.push(entry);signal?.addEventListener('abort',abort,{once:true});
  });
  queueMicrotask(()=>this.start());
  return result;
 }
 private start():void {
  if(this.running)return;
  const next=this.waiting.shift();
  if(!next){this.finishClose?.();return;}
  this.running=true;next.detach();
  void next.run();
 }
 private complete():void{this.running=false;this.start();}
 close():Promise<void>{
  if(this.drained)return this.drained;
  this.closed=true;
  for(const entry of this.waiting.splice(0))entry.cancel();
  return this.drained=this.running?new Promise<void>(resolve=>{this.finishClose=resolve;}):Promise.resolve();
 }
}
