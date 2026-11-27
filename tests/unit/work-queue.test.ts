import {expect,test} from 'bun:test';
import {WorkQueue} from '../../src/server/work-queue.ts';
import {boundedText} from '../../src/server/bounded-body.ts';

test('bounded queue serializes work, refuses overflow and survives rejection',async()=>{
 const q=new WorkQueue(2),order:number[]=[];
 let release!:()=>void;
 const first=q.tryRun(async()=>{order.push(1);await new Promise<void>(r=>{release=r;});throw Error('failed');})!;
 const second=q.tryRun(async()=>{order.push(2);return 2;})!;
 expect(q.size).toBe(2);expect(q.tryRun(async()=>3)).toBeNull();
 const rejected=expect(first).rejects.toThrow('failed');
 await Promise.resolve();expect(order).toEqual([1]);release();
 await rejected;expect(await second).toBe(2);expect(q.size).toBe(0);
 expect(await q.tryRun(async()=>3)).toBe(3);await q.close();
 expect(q.tryRun(async()=>4)).toBeNull();
});
test('shutdown waits for running mutation but cancels queued work',async()=>{
 const q=new WorkQueue(3);let release!:()=>void,runs=0;
 const first=q.tryRun(async()=>{await new Promise<void>(r=>{release=r;});runs++;})!;
 const second=q.tryRun(async()=>{runs++;})!;
 const rejected=expect(second).rejects.toThrow('WORK_CANCELLED');
 await Promise.resolve();const closed=q.close();release();await first;await rejected;await closed;
 expect(runs).toBe(1);expect(q.size).toBe(0);
});
test('body limit counts UTF-8 bytes and ignores a misleading length header',async()=>{
 const body='あいう';
 expect(await boundedText(new Request('http://localhost',{method:'POST',body}),9)).toBe(body);
 await expect(boundedText(new Request('http://localhost',{method:'POST',body,headers:{'content-length':'1'}}),8)).rejects.toThrow('COMMAND_TOO_LARGE');
 await expect(boundedText(new Request('http://localhost',{method:'POST',body,headers:{'content-length':'100'}}),9)).rejects.toThrow('COMMAND_TOO_LARGE');
});
