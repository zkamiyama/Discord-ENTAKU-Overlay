/** Limit admission, not just concurrency. A rejected or aborted task never
 * poisons the following work. The running operation is allowed to commit before
 * shutdown finishes; accepted but not started operations are cancelled. */
export class WorkQueue {
 private tail:Promise<void>=Promise.resolve();
 private pending=0;
 private closed=false;
 constructor(private readonly limit:number){
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('INVALID_QUEUE_LIMIT');
 }
 get size():number{return this.pending;}
 tryRun<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>|null {
  if(this.closed||this.pending>=this.limit)return null;
  this.pending++;
  const result=this.tail.then(()=>{
   if(this.closed||signal?.aborted)throw new Error('WORK_CANCELLED');
   return work();
  }).finally(()=>{this.pending--;});
  this.tail=result.then(()=>{},()=>{});
  return result;
 }
 close():Promise<void>{this.closed=true;return this.tail;}
}
