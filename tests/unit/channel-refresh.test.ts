import {expect,test} from 'bun:test';
import {ChannelRefresh} from '../../src/discord/channel-refresh.ts';
import {DiscordError} from '../../src/discord/errors.ts';

const options = {intervalMs: 10000, retryMs: 5, maxFailures: 3};
async function until(check: () => boolean): Promise<void> {
  for (let i=0; i<200 && !check(); i++) await Bun.sleep(5);
  expect(check()).toBe(true);
}
test('one timeout retries in the same session without losing the last snapshot',async()=>{
  let reads=0;const accepted:unknown[]=[],errors:unknown[]=[];
  const client={isClosed:false,request:async()=>{if(++reads===1)throw new DiscordError('RPC_TIMEOUT');return {id:'200'};}};
  const refresh=new ChannelRefresh(client,'200',raw=>accepted.push(raw),e=>errors.push(e),options);
  try{await refresh.refresh();expect(accepted).toEqual([]);expect(errors).toEqual([]);await until(()=>accepted.length===1);expect(reads).toBe(2);expect(errors).toEqual([]);}finally{refresh.dispose();}
});
test('repeated timeout is bounded; permissions and snapshot corruption do not retry',async()=>{
  for(const reason of [new DiscordError('RPC_TIMEOUT'),new DiscordError('RPC_REJECTED',5001),new DiscordError('SNAPSHOT_INCONSISTENT')]){
    let reads=0;const errors:DiscordError[]=[];
    const refresh=new ChannelRefresh({isClosed:false,request:async()=>{reads++;throw reason;}},'200',()=>{},e=>errors.push(e),options);
    try{await refresh.refresh();await until(()=>errors.length===1);expect(reads).toBe(reason.code==='RPC_TIMEOUT'?3:1);expect(errors[0]).toBe(reason);await refresh.refresh();expect(errors).toHaveLength(1);}finally{refresh.dispose();}
  }
});
test('a disposed session ignores delayed success and cannot restart its timers',async()=>{
  let resolve!:(value:unknown)=>void,reads=0;
  const accepted:unknown[]=[];
  const refresh=new ChannelRefresh({isClosed:false,request:()=>{reads++;return new Promise(r=>{resolve=r;});}},'200',raw=>accepted.push(raw),()=>{throw Error('unexpected failure');},options);
  const task=refresh.refresh();await refresh.refresh();expect(reads).toBe(1);refresh.dispose();resolve({id:'200'});await task;refresh.start();await refresh.refresh();expect(reads).toBe(1);expect(accepted).toEqual([]);
});
test('success resets timeout budget for later refreshes',async()=>{
  let reads=0;const errors:unknown[]=[],accepted:unknown[]=[];
  const refresh=new ChannelRefresh({isClosed:false,request:async()=>{if(++reads%2)throw new DiscordError('RPC_TIMEOUT');return reads;}},'200',raw=>accepted.push(raw),e=>errors.push(e),{...options,maxFailures:2});
  try{for(let i=1;i<=3;i++){await refresh.refresh();await until(()=>accepted.length===i);}expect(errors).toEqual([]);}finally{refresh.dispose();}
});
