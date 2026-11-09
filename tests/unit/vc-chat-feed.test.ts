import {expect,test} from 'bun:test';
import {VcChatFeed} from '../../src/chat/vc-chat-feed.ts';
import {CHAT_BYTE_LIMIT} from '../../src/contracts/vc-chat.ts';
import {DiscordError} from '../../src/discord/errors.ts';
const selected={id:'200',name:'Test VC',type:2};
const message=(id='1',content='synthetic',channel_id='200')=>({id,channel_id,author:{id:'42',username:'Synthetic author'},content,timestamp:new Date(1700000000000+Number(id)).toISOString()});
function setup(fail?:string){
 const feed=new VcChatFeed('connecting',1700000000000),listeners=new Set<(p:Record<string,unknown>)=>void>(),requests:string[]=[];
 const rpc={onEvent:(fn:(p:Record<string,unknown>)=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},request:async(_cmd:string,_args:unknown,evt?:string)=>{requests.push(evt!);if(evt===fail)throw new DiscordError('RPC_REJECTED',5001);return {evt};}};
 const send=(evt:string,msg:unknown,channel_id='200')=>{for(const fn of listeners)fn({cmd:'DISPATCH',evt,data:{channel_id,message:msg}});};
 return {feed,rpc,send,listeners,requests};
}
const settle=()=>Bun.sleep(5);
test('chat starts without environment flags, hydrates history and subscribes to create/update/delete',async()=>{
 const f=setup();await f.feed.start(f.rpc,selected,{...selected,messages:[message('2'),message('1')]});await settle();
 expect(f.requests).toEqual(['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE']);
 expect(f.feed.snapshot()).toMatchObject({status:'live',channelId:'200',channelName:'Test VC',updates:true,deletions:true});
 expect(f.feed.snapshot().messages.map(m=>m.id)).toEqual(['1','2']);
 f.send('MESSAGE_CREATE',message('3','new'));f.send('MESSAGE_CREATE',message('3','new'));expect(f.feed.snapshot().messages).toHaveLength(3);
 f.send('MESSAGE_UPDATE',{id:'3',content:'edited',edited_timestamp:new Date().toISOString()});
 f.feed.mergeHistory({...selected,messages:[message('3','old snapshot')]});expect(f.feed.snapshot().messages.at(-1)?.content).toBe('edited');
 f.send('MESSAGE_DELETE',{id:'3'});f.send('MESSAGE_CREATE',message('3','late duplicate'));f.feed.mergeHistory({...selected,messages:[message('3','stale deleted')]});expect(f.feed.snapshot().messages).toHaveLength(2);
});
test('wrong channels, malformed data and blocked messages are ignored; nested channel is accepted',async()=>{
 const f=setup();await f.feed.start(f.rpc,selected);
 f.send('MESSAGE_CREATE',message('1','OTHER','201'),'201');f.send('MESSAGE_CREATE',message('2','CONFLICT','201'));
 f.send('MESSAGE_CREATE',{...message('3'),blocked:true});f.send('MESSAGE_CREATE',null);f.send('MESSAGE_CREATE',{id:'4',author:{id:'42'},content:'INVALID'});
 expect(f.feed.snapshot().messages).toEqual([]);
 f.send('MESSAGE_CREATE',message('5'),'');expect(f.feed.snapshot().messages).toEqual([]);
 for(const fn of f.listeners)fn({cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{message:message('5')}});
 expect(f.feed.snapshot().messages).toHaveLength(1);
 f.send('MESSAGE_UPDATE',{id:'5',blocked:true});expect(f.feed.snapshot().messages).toEqual([]);
});
test('a pending ACK and old event handlers cannot restore the previous VC after a move',async()=>{
 const f=setup();let resolve!:(value:unknown)=>void;
 const delayed={...f.rpc,request:()=>new Promise(r=>{resolve=r;})};f.feed.start(delayed,selected);const old=[...f.listeners][0]!;
 await f.feed.start(f.rpc,{...selected,id:'201'});old({cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:'200',message:message()}});resolve({evt:'MESSAGE_CREATE'});await settle();
 expect(f.feed.snapshot()).toMatchObject({channelId:'201',status:'live',messages:[]});expect(f.listeners.size).toBe(1);
 f.feed.disconnect();expect(f.listeners.size).toBe(0);expect(f.feed.snapshot().messages).toEqual([]);
});
test('primary failure is visible; optional failure does not disable new messages',async()=>{
 const f=setup('MESSAGE_CREATE');await f.feed.start(f.rpc,selected)?.catch(()=>{});await settle();
 expect(f.feed.snapshot()).toMatchObject({status:'error',errorCode:'RPC_REJECTED',rpcCode:5001});expect(f.listeners.size).toBe(0);
 const partial=setup('MESSAGE_UPDATE');await partial.feed.start(partial.rpc,selected);await settle();partial.send('MESSAGE_CREATE',message());
 expect(partial.feed.snapshot()).toMatchObject({status:'live',updates:false,deletions:true});expect(partial.feed.snapshot().messages).toHaveLength(1);
});
test('messages, text and byte count are bounded, including arbitrary history order',async()=>{
 const f=setup();await f.feed.start(f.rpc,selected,{...selected,messages:Array.from({length:150},(_,i)=>message(String(150-i)))});
 expect(f.feed.snapshot().messages).toHaveLength(100);expect(f.feed.snapshot().messages[0]?.id).toBe('51');
 for(let i=151;i<280;i++)f.send('MESSAGE_CREATE',message(String(i),'日本語'.repeat(3000)));
 const list=f.feed.snapshot().messages;expect(list.length).toBeLessThanOrEqual(100);expect(list.at(-1)?.truncated).toBe(true);
 expect(list.every(m=>m.content.length<=4000)).toBe(true);expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThan(CHAT_BYTE_LIMIT+1024);
});
test('only server VC is eligible and new history cannot alter another channel',async()=>{
 const f=setup();f.feed.start(f.rpc,null);expect(f.feed.snapshot().status).toBe('no-channel');
 f.feed.start(f.rpc,{...selected,type:3});expect(f.feed.snapshot().status).toBe('unsupported');expect(f.requests).toEqual([]);
 await f.feed.start(f.rpc,selected);f.feed.mergeHistory({...selected,id:'201',messages:[message()]});expect(f.feed.snapshot().messages).toEqual([]);
});
test('observer exceptions and raw peer errors cannot escape or disclose credentials',async()=>{
 const f=setup();f.feed.observe(()=>{throw Error('SECRET_CALLBACK');});await f.feed.start(f.rpc,selected);expect(()=>f.send('MESSAGE_CREATE',message())).not.toThrow();
 const bad={...f.rpc,request:async()=>{throw Error('SECRET_TOKEN');}};await f.feed.start(bad,selected)?.catch(()=>{});await settle();
 expect(JSON.stringify(f.feed.snapshot())).not.toContain('SECRET');expect(f.feed.snapshot().errorCode).toBe('CHAT_SUBSCRIBE_FAILED');
});
test('raw HTML remains inert text; attachment-only posts and Unicode names are retained',async()=>{
 const f=setup();await f.feed.start(f.rpc,selected);f.send('MESSAGE_CREATE',{...message('1','<img src=x onerror=alert(1)>\n2行目'),author:{id:'42',username:'ascii',global_name:'テスト名'}});
 f.send('MESSAGE_CREATE',{...message('2',''),attachments:[{url:'https://private.invalid/secret',filename:'private.png'}]});
 expect(f.feed.snapshot().messages[0]?.authorName).toBe('テスト名');expect(f.feed.snapshot().messages[0]?.content).toContain('<img');
 expect(f.feed.snapshot().messages[1]?.attachmentCount).toBe(1);expect(JSON.stringify(f.feed.snapshot())).not.toContain('private.invalid');
});

test('startup cutoff rejects earlier history and edits, remains fixed across reconnect and VC changes',async()=>{
 const f=setup(),feed=new VcChatFeed('connecting',1700000000010);
 await feed.start(f.rpc,selected,{...selected,messages:[message('9','before'),message('10','at boot'),message('11','after')]});
 expect(feed.snapshot().messages.map(m=>m.id)).toEqual(['10','11']);
 f.send('MESSAGE_CREATE',message('8','old dispatch'));f.send('MESSAGE_UPDATE',{...message('7','old edit'),edited_timestamp:new Date().toISOString()});
 expect(feed.snapshot().messages.map(m=>m.id)).toEqual(['10','11']);
 feed.disconnect();await feed.start(f.rpc,selected,{...selected,messages:[message('9'),message('11')]});expect(feed.snapshot().messages.map(m=>m.id)).toEqual(['11']);
 await feed.start(f.rpc,{...selected,id:'201'},{...selected,id:'201',messages:[message('9','old','201'),message('12','new VC','201')]});expect(feed.snapshot().messages.map(m=>m.id)).toEqual(['12']);
 feed.disconnect();
});
