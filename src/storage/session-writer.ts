import type {SeatSession} from '../contracts/domain.ts';

const signature=(session:SeatSession)=>`${session.sessionId}:${session.revision}`;
interface PendingSession {session:SeatSession;generation:number;signature:string}
interface SessionCheckpoint {sessions:readonly SeatSession[];generation:number}

/** One write at a time, with only the latest outstanding snapshot per channel.
 * A failed write stays dirty. The next offer/flush retries it; failure never
 * advances the durable signature or spins an immediate retry loop. */
export class SessionWriter {
 private readonly durable=new Map<string,string>();
 private readonly pending=new Map<string,PendingSession>();
 private current:PendingSession|null=null;
 private worker?:Promise<void>;
 private generation:number;
 constructor(
  private readonly save:(session:SeatSession,generation:number)=>boolean|Promise<boolean>,
  initial:SessionCheckpoint={sessions:[],generation:0},
  private readonly onError:(error:unknown)=>void=()=>{},
 ){
  this.generation=initial.generation;
  for(const session of initial.sessions)this.durable.set(session.channelId,signature(session));
 }
 get pendingCount():number{return this.pending.size;}
 offer(sessions:readonly SeatSession[],generation:number):void {
  if(generation<this.generation)return;
  this.generation=generation;
  for(const session of sessions){
   const key=signature(session),channel=session.channelId;
   if(this.durable.get(channel)===key&&this.current?.session.channelId!==channel){
    this.pending.delete(channel);continue;
   }
   const previous=this.pending.get(channel);
   // Unchanged durable sessions need no write when settings change. A dirty
   // snapshot still needs the latest fence, even when its content is identical.
   if(previous?.signature===key&&previous.generation===generation)continue;
   this.pending.set(channel,{session:structuredClone(session),generation,signature:key});
  }
  if(this.pending.size)void this.start();
 }
 private start():Promise<void>{
  if(this.worker)return this.worker;
  const run=Promise.resolve().then(()=>this.writePending());
  this.worker=run;
  void run.then(()=>{if(this.worker===run)this.worker=undefined;});
  return run;
 }
 private async writePending():Promise<void>{
  const failed=new Set<string>();
  for(;;){
   const next=[...this.pending].find(([channel])=>!failed.has(channel));
   if(!next)return;
   const [channel,pending]=next;
   this.current=pending;
   try{
    // A preset transaction advances settings generation and writes its active
    // session atomically. A queued older generation is retired, never retried.
    if(await this.save(pending.session,pending.generation))this.durable.set(channel,pending.signature);
    if(this.pending.get(channel)===pending)this.pending.delete(channel);
   }catch(error){
    failed.add(channel);
    try{this.onError(error);}catch{/* Reporting cannot discard the pending write. */}
   }finally{this.current=null;}
  }
 }
 /** Stop producers first, then drain their final snapshots. Retry each failed
  * channel once more and report failure if the durable store is still unavailable. */
 async flush():Promise<void>{
  if(this.worker)await this.worker;
  if(this.pending.size)await this.start();
  if(this.pending.size)throw new Error('SESSION_WRITE_FAILED');
 }
}
