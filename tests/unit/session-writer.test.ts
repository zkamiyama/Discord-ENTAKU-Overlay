import {expect,test} from 'bun:test';
import {SessionWriter} from '../../src/storage/session-writer.ts';
import {newSession} from '../../src/domain/seat-allocator.ts';
import type {SeatSession} from '../../src/contracts/domain.ts';

const session=(revision:number,channelId='200'):SeatSession=>({...newSession(channelId,'session-'+channelId),revision});
function deferred(){let resolve!:()=>void;const ready=new Promise<void>(done=>{resolve=done;});return {ready,resolve};}

test('slow storage retains one latest snapshot per channel and flush writes the final revision',async()=>{
 const gate=deferred(),entered=deferred(),writes:number[]=[];let active=0,maximum=0;
 const writer=new SessionWriter(async value=>{
  active++;maximum=Math.max(maximum,active);writes.push(value.revision);
  if(value.revision===1){entered.resolve();await gate.ready;}
  active--;return true;
 });
 writer.offer([session(1)],0);await entered.ready;
 for(let revision=2;revision<=1000;revision++)writer.offer([session(revision)],0);
 expect(writer.pendingCount).toBe(1);expect(writes).toEqual([1]);
 gate.resolve();await writer.flush();
 expect(writes).toEqual([1,1000]);expect(maximum).toBe(1);expect(writer.pendingCount).toBe(0);
 writer.offer([session(1000)],0);await writer.flush();expect(writes).toEqual([1,1000]);
});

test('a failed write stays dirty and retry records success only after the store accepts it',async()=>{
 let fail=true,errors=0;const writes:number[]=[];
 const writer=new SessionWriter(async value=>{writes.push(value.revision);if(fail)throw Error('disk unavailable');return true;},{sessions:[],generation:0},()=>{errors++;});
 writer.offer([session(1)],0);
 await expect(writer.flush()).rejects.toThrow('SESSION_WRITE_FAILED');
 expect(writer.pendingCount).toBe(1);expect(errors).toBe(2);
 fail=false;writer.offer([session(1)],0);await writer.flush();
 expect(writes).toEqual([1,1,1]);expect(writer.pendingCount).toBe(0);
 writer.offer([session(1)],0);await writer.flush();expect(writes).toEqual([1,1,1]);
});

test('a failed channel does not block other channels or replace its newest queued snapshot',async()=>{
 const gate=deferred(),entered=deferred(),writes:string[]=[];let fail=true;
 const writer=new SessionWriter(async value=>{
  writes.push(`${value.channelId}:${value.revision}`);
  if(value.channelId==='200'&&value.revision===1){entered.resolve();await gate.ready;throw Error('old write failed');}
  if(value.channelId==='200'&&fail)throw Error('disk unavailable');
  return true;
 });
 writer.offer([session(1),session(1,'201')],0);await entered.ready;
 const latest=session(9);writer.offer([latest],0);latest.revision=999;
 gate.resolve();await expect(writer.flush()).rejects.toThrow('SESSION_WRITE_FAILED');
 expect(writes).toEqual(['200:1','201:1','200:9']);expect(writer.pendingCount).toBe(1);
 fail=false;await writer.flush();expect(writes.at(-1)).toBe('200:9');expect(writer.pendingCount).toBe(0);
});

test('restored sessions are already durable and reverting an in-flight write still persists the final value',async()=>{
 const initial=session(4),gate=deferred(),entered=deferred(),writes:number[]=[];
 const writer=new SessionWriter(async value=>{writes.push(value.revision);if(value.revision===5){entered.resolve();await gate.ready;}return true;},{sessions:[initial],generation:0});
 writer.offer([initial],0);await writer.flush();expect(writes).toEqual([]);
 writer.offer([session(5)],0);await entered.ready;writer.offer([initial],0);gate.resolve();await writer.flush();
 expect(writes).toEqual([5,4]);expect(writer.pendingCount).toBe(0);
});

test('a preset fences pending older generations without discarding an identical new-generation snapshot',async()=>{
 const gate=deferred(),entered=deferred(),saved:string[]=[],attempted:string[]=[];let generation=0;
 const writer=new SessionWriter(async(value,offeredGeneration)=>{
  attempted.push(`${offeredGeneration}:${value.revision}`);
  if(offeredGeneration===0){entered.resolve();await gate.ready;}
  if(offeredGeneration<generation)return false;
  saved.push(`${offeredGeneration}:${value.revision}`);return true;
 });
 writer.offer([session(1)],0);await entered.ready;
 generation=1;writer.offer([session(1)],1);
 writer.offer([session(999)],0); // A late producer cannot replace the new generation.
 gate.resolve();await writer.flush();
 expect(attempted).toEqual(['0:1','1:1']);expect(saved).toEqual(['1:1']);expect(writer.pendingCount).toBe(0);
 writer.offer([session(1)],1);await writer.flush();expect(attempted).toEqual(['0:1','1:1']);
});

test('retired writes do not become durable and a dirty snapshot can retry in the latest generation',async()=>{
 const initial=session(4),attempted:number[]=[];
 const writer=new SessionWriter((_value,generation)=>{attempted.push(generation);return generation===9;},{sessions:[initial],generation:7});
 writer.offer([initial],7);await writer.flush();expect(attempted).toEqual([]);
 writer.offer([session(5)],8);await writer.flush();expect(attempted).toEqual([8]);expect(writer.pendingCount).toBe(0);
 writer.offer([session(5)],9);await writer.flush();expect(attempted).toEqual([8,9]);
 writer.offer([session(5)],9);await writer.flush();expect(attempted).toEqual([8,9]);
});

test('settings generation changes do not rewrite a thousand already durable channel sessions',async()=>{
 const sessions=Array.from({length:1000},(_,i)=>session(4,String(i+1))),saved:string[]=[];
 const writer=new SessionWriter((value,generation)=>{saved.push(`${value.channelId}:${generation}`);return true;},{sessions,generation:10});
 writer.offer(sessions,11);await writer.flush();expect(saved).toEqual([]);
 const updated=sessions.map((value,i)=>i===0?{...value,sessionId:'preset-replacement',revision:0}:value);
 writer.offer(updated,12);await writer.flush();expect(saved).toEqual(['1:12']);
 writer.offer(updated,13);await writer.flush();expect(saved).toEqual(['1:12']);expect(writer.pendingCount).toBe(0);
});
