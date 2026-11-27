import {expect,test} from 'bun:test';
import {ResourceCache} from '../../src/web/gaussian/resource-cache.ts';

test('duplicate callback identity does not remove another live lease',async()=>{
 const cache=new ResourceCache<number,string>('loading',()=>{});
 const statuses:string[]=[];const observe=(s:string)=>statuses.push(s);
 const load=async(_signal:AbortSignal,status:(s:string)=>void)=>{status('ready');return 1;};
 const a=cache.acquire('a',load,observe),b=cache.acquire('a',load,observe);
 a.release();await b.ready;
 expect(statuses).toEqual(['loading','loading','ready']);
 expect(cache.snapshot()[0]?.references).toBe(1);
 b.release();expect(cache.size).toBe(0);
});
test('a throwing subscriber does not leak a lease or reject a shared load',async()=>{
 const destroyed:number[]=[];const cache=new ResourceCache<number,string>('loading',v=>destroyed.push(v));
 const load=async(_signal:AbortSignal,status:(s:string)=>void)=>{status('ready');return 0;};
 const a=cache.acquire('a',load,()=>{throw Error('UI failure');});
 const statuses:string[]=[];const b=cache.acquire('a',load,s=>statuses.push(s));
 expect(await a.ready).toBe(0);expect(await b.ready).toBe(0);
 expect(statuses).toEqual(['loading','ready']);
 a.release();b.release();b.release();expect(cache.size).toBe(0);
 expect(destroyed).toEqual([0]);
});
test('synchronous reacquisition in abort listener receives a new entry',async()=>{
 const destroyed:number[]=[];const cache=new ResourceCache<number,string>('loading',v=>destroyed.push(v));
 let replacement:ReturnType<typeof cache.acquire>|undefined;
 const first=cache.acquire('a',async(signal)=>{
  signal.addEventListener('abort',()=>{replacement=cache.acquire('a',async()=>2);},{once:true});
  return 1;
 });
 expect(await first.ready).toBe(1);
 first.release();
 expect(replacement).toBeDefined();expect(await replacement!.ready).toBe(2);
 expect(cache.size).toBe(1);expect(destroyed).toEqual([1]);
 replacement!.release();expect(destroyed).toEqual([1,2]);expect(cache.size).toBe(0);
});
