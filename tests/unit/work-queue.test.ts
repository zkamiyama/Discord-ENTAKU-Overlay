import {expect,test} from 'bun:test';
import {WorkQueue} from '../../src/server/work-queue.ts';
import {boundedText} from '../../src/server/bounded-body.ts';

test('bounded queue serializes work, refuses overflow and survives rejection',async()=>{
 const q=new WorkQueue(2),order:number[]=[];
 let release!:()=>void;
 const first=q.tryRun(async()=>{order.push(1);await new Promise<void>(r=>{release=r;});throw Error('failed');})!;
 const second=q.tryRun(async()=>{order.push(2);return 2;})!;
 expect(q.size).toBe(2);expect(q.tryRun(async()=>3)).toBeNull();
 const rejected=first.catch(error=>error as Error);
 await Promise.resolve();expect(order).toEqual([1]);release();
 expect((await rejected).message).toBe('failed');expect(await second).toBe(2);expect(q.size).toBe(0);
 expect(await q.tryRun(async()=>3)).toBe(3);await q.close();
 expect(q.tryRun(async()=>4)).toBeNull();
});
test('shutdown waits for running mutation but cancels queued work',async()=>{
 const q=new WorkQueue(3);let release!:()=>void,runs=0;
 const first=q.tryRun(async()=>{await new Promise<void>(r=>{release=r;});runs++;})!;
 const second=q.tryRun(async()=>{runs++;})!;
 const rejected=second.catch(error=>error as Error);
 await Promise.resolve();const closed=q.close();release();await first;expect(await rejected).toBeInstanceOf(Error);await closed;
 expect(runs).toBe(1);expect(q.size).toBe(0);
});
test('body limit counts UTF-8 bytes and ignores a misleading length header',async()=>{
 const body='あいう';
 expect(await boundedText(new Request('http://localhost',{method:'POST',body}),9)).toBe(body);
 await expect(boundedText(new Request('http://localhost',{method:'POST',body,headers:{'content-length':'1'}}),8)).rejects.toThrow('COMMAND_TOO_LARGE');
 await expect(boundedText(new Request('http://localhost',{method:'POST',body,headers:{'content-length':'100'}}),9)).rejects.toThrow('COMMAND_TOO_LARGE');
});

test('aborting waiting work frees admission immediately without cancelling the active transaction',async()=>{
 const q=new WorkQueue(2),abort=new AbortController(),activeAbort=new AbortController();
 let release!:()=>void,runs=0;
 const first=q.tryRun(async()=>{await new Promise<void>(r=>{release=r;});runs++;},activeAbort.signal)!;
 await Promise.resolve();
 const second=q.tryRun(async()=>{runs+=100;},abort.signal)!;
 const rejected=second.catch(error=>error as Error);
 abort.abort();expect(await rejected).toEqual(Error('WORK_CANCELLED'));expect(q.size).toBe(1);
 const third=q.tryRun(async()=>++runs)!;expect(third).not.toBeNull();
 activeAbort.abort();release();await first;expect(await third).toBe(2);
 expect(q.size).toBe(0);await q.close();
});

test('shutdown rejects waiting work immediately while a running transaction is still pending',async()=>{
 const q=new WorkQueue(2);let release!:()=>void;
 const running=q.tryRun(()=>new Promise<void>(resolve=>{release=resolve;}))!;
 await Promise.resolve();
 const waiting=q.tryRun(async()=>{throw Error('must not execute');})!;
 const rejected=waiting.catch(error=>error as Error);
 const stopping=q.close();expect(await rejected).toEqual(Error('WORK_CANCELLED'));expect(q.size).toBe(1);expect(q.close()).toBe(stopping);
 release();await running;await stopping;expect(q.size).toBe(0);
});

test('aborted body reads cancel their source and release the reader',async()=>{
 const abort=new AbortController();let cancelled=false;
 const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 const request=new Request('http://localhost',{method:'POST',body,signal:abort.signal});
 const rejected=boundedText(request,256).catch(error=>error as Error);
 abort.abort(Error('stop reading'));expect(await rejected).toEqual(Error('stop reading'));
 expect(cancelled).toBe(true);expect(body.locked).toBe(false);
});
