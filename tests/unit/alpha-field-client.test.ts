import {expect,test} from 'bun:test';
import {AlphaFieldQueue} from '../../src/web/overlay/alpha-field-client.ts';

class FakeWorker {
 onmessage:Worker['onmessage']=null;
 onerror:Worker['onerror']=null;
 onmessageerror:Worker['onmessageerror']=null;
 posts:Array<{alpha:Uint8Array;width:number;height:number;spread:number}>=[];
 terminated=0;
 postMessage(value:typeof this.posts[number]):void{this.posts.push(value);}
 terminate():void{this.terminated++;}
 complete():void{
  const {width,height,spread}=this.posts.at(-1)!;
  this.onmessage?.call(this as unknown as Worker,{data:{field:{width,height,spread,data:new Uint8Array(width*height)}}} as MessageEvent);
 }
 fail():void{this.onerror?.call(this as unknown as Worker,{} as ErrorEvent);}
}
function fixture(capacity=3,timeoutMs=10_000){
 const workers:FakeWorker[]=[];
 const queue=new AlphaFieldQueue(()=>{const worker=new FakeWorker();workers.push(worker);return worker;},capacity,timeoutMs);
 const run=(signal?:AbortSignal)=>queue.run(new Uint8Array(4),2,2,16,signal);
 return {queue,workers,run};
}
test('distance fields reuse one worker, bound admission and immediately release cancelled waiting jobs',async()=>{
 const {queue,workers,run}=fixture(2),abort=new AbortController();
 try{
  const first=run(),waiting=run(abort.signal).catch(error=>error as Error);
  await expect(run()).rejects.toThrow('ALPHA_FIELD_BUSY');expect(queue.size).toBe(2);expect(workers[0]!.posts).toHaveLength(1);
  abort.abort(Error('obsolete'));expect(await waiting).toEqual(Error('obsolete'));expect(queue.size).toBe(1);
  const next=run();workers[0]!.complete();expect((await first).data).toHaveLength(4);
  expect(workers).toHaveLength(1);expect(workers[0]!.posts).toHaveLength(2);
  workers[0]!.complete();await next;expect(queue.size).toBe(0);expect(workers[0]!.terminated).toBe(0);
 }finally{queue.dispose();}
 expect(workers[0]!.terminated).toBe(1);
});
test('cancelling active computation retires its worker and stale events cannot complete its successor',async()=>{
 const {queue,workers,run}=fixture(),abort=new AbortController();
 try{
  const first=run(abort.signal).catch(error=>error as Error),old=workers[0]!,late=old.onmessage!;
  let settled=false;const second=run().then(field=>{settled=true;return field;});
  abort.abort(Error('cancelled'));expect(await first).toEqual(Error('cancelled'));expect(old.terminated).toBe(1);expect(workers).toHaveLength(2);
  late.call(old as unknown as Worker,{data:{field:{width:2,height:2,spread:16,data:new Uint8Array(4)}}} as MessageEvent);
  await Promise.resolve();expect(settled).toBe(false);
  workers[1]!.complete();await second;expect(settled).toBe(true);
 }finally{queue.dispose();}
});
test('worker failures and invalid results reject only the active job and let the next owner proceed',async()=>{
 const {queue,workers,run}=fixture();
 try{
  const first=run().catch(error=>error as Error),second=run().catch(error=>error as Error),third=run();
  workers[0]!.fail();expect(await first).toEqual(Error('ALPHA_FIELD_FAILED'));
  workers[1]!.onmessage!.call(workers[1] as unknown as Worker,{data:{field:{width:2,height:2,spread:16,data:new Uint8Array(1)}}} as MessageEvent);
  expect(await second).toEqual(Error('ALPHA_FIELD_FAILED'));expect(workers[1]!.terminated).toBe(1);
  workers[2]!.complete();await third;
  workers[2]!.fail();expect(workers[2]!.terminated).toBe(1);
  const recovered=run();expect(workers).toHaveLength(4);workers[3]!.complete();await recovered;
 }finally{queue.dispose();}
});
test('a stalled worker has a deadline and shutdown rejects every retained image exactly once',async()=>{
 const {queue,workers,run}=fixture(3,10);
 const timeout=run().catch(error=>error as Error);
 expect(await timeout).toEqual(Error('ALPHA_FIELD_TIMEOUT'));expect(workers[0]!.terminated).toBe(1);
 const active=run().catch(error=>error as Error),waiting=run().catch(error=>error as Error);
 queue.dispose();queue.dispose();expect(await active).toEqual(Error('ALPHA_FIELD_DISPOSED'));expect(await waiting).toEqual(Error('ALPHA_FIELD_DISPOSED'));
 expect(queue.size).toBe(0);expect(workers[1]!.terminated).toBe(1);
 await expect(run()).rejects.toThrow('ALPHA_FIELD_DISPOSED');
});
test('pre-cancelled owners and failed worker startup retain neither a queue slot nor a worker',async()=>{
 const {queue,workers,run}=fixture(),abort=new AbortController();abort.abort(Error('already cancelled'));
 await expect(run(abort.signal)).rejects.toThrow('already cancelled');expect(workers).toHaveLength(0);expect(queue.size).toBe(0);queue.dispose();
 let starts=0;const broken=new AlphaFieldQueue(()=>{starts++;throw Error('worker unavailable');});
 await expect(broken.run(new Uint8Array(1),1,1)).rejects.toThrow('worker unavailable');expect(broken.size).toBe(0);expect(starts).toBe(1);broken.dispose();
});
