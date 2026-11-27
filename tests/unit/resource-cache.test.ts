import {expect,test} from 'bun:test';
import {ResourceCache} from '../../src/web/shared/resource-cache.ts';

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

test('releasing the last lease before loading starts never calls the loader',async()=>{
 let loads=0;
 const cache=new ResourceCache<number,undefined>(undefined,()=>{});
 const lease=cache.acquire('a',async()=>{loads++;return 1;});
 const failure=lease.ready.catch(error=>error);
 lease.release();
 expect((await failure).message).toBe('RESOURCE_LOAD_RETIRED');
 expect(loads).toBe(0);expect(cache.size).toBe(0);cache.dispose();
});

test('shutdown settles outstanding leases even when decoding cannot be cancelled',async()=>{
 const destroyed:number[]=[];
 const cache=new ResourceCache<number,undefined>(undefined,value=>destroyed.push(value));
 let resolve!:(value:number)=>void;
 const lease=cache.acquire('a',async()=>new Promise<number>(done=>{resolve=done;}));
 const failure=lease.ready.catch(error=>error);
 await Promise.resolve();cache.dispose();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const result=await Promise.race([failure,new Promise(resolve=>{timer=setTimeout(()=>resolve('still pending'),50);})]);
 if(timer!==undefined)clearTimeout(timer);
 resolve(7);
 // A non-cancellable decoder may complete later; its result still has one owner.
 await new Promise(done=>setTimeout(done,0));
 expect(result).toBeInstanceOf(Error);
 expect((result as Error).message).toBe('RESOURCE_LOAD_RETIRED');
 expect(destroyed).toEqual([7]);expect(cache.size).toBe(0);
});

test('a retired loader can fail late without affecting its replacement or aborting twice',async()=>{
 let reject!:(error:Error)=>void,aborts=0;
 const cache=new ResourceCache<number,string>('loading',()=>{});
 const old=cache.acquire('a',signal=>{
  signal.addEventListener('abort',()=>{aborts++;});
  return new Promise<number>((_,fail)=>{reject=fail;});
 });
 const failure=old.ready.catch(error=>error);
 await Promise.resolve();old.release();old.release();
 expect((await failure).message).toBe('RESOURCE_LOAD_RETIRED');
 const current=cache.acquire('a',async()=>2);
 expect(await current.ready).toBe(2);
 reject(new Error('Late decoder failure'));
 await new Promise(done=>setTimeout(done,0));
 expect(aborts).toBe(1);expect(cache.snapshot()[0]?.value).toBe(2);
 current.release();cache.dispose();expect(aborts).toBe(1);expect(cache.size).toBe(0);
});
