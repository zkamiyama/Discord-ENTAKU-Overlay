import {expect,test} from 'bun:test';
import {emptyMisskeyState,parseMisskeyState,type MisskeyState} from '../../src/contracts/misskey.ts';
import {StudioClient} from '../../src/web/shared/client.ts';
class Socket {
 readyState=1;onmessage:WebSocket['onmessage']=null;onclose:WebSocket['onclose']=null;onerror:WebSocket['onerror']=null;sent:string[]=[];
 send(value:string){this.sent.push(value);}close(){this.readyState=3;}
 receive(value:unknown){this.onmessage?.call(this as unknown as WebSocket,{data:JSON.stringify(value)} as MessageEvent);}
}
const state=():MisskeyState=>({...emptyMisskeyState(),status:'live',revision:1,cards:[{id:'note1',userId:'user1',username:'guest',authorName:'Guest',text:'Synthetic #NicoMiss',url:'https://otomad.site/notes/note1',createdAt:new Date(1_000_000).toISOString(),shownAt:1_000_000,expiresAt:1_045_000,slot:0,truncated:false}]});
test('wire validation rejects unbounded cards, duplicate slots, foreign links and non-finite lifetimes',()=>{
 const good=state();expect(parseMisskeyState(good)).toEqual(good);
 for(const bad of [{...good,cards:Array(31).fill(good.cards[0])},{...good,cards:[...good.cards,...good.cards]},
  {...good,cards:[{...good.cards[0],url:'https://other.example/notes/note1'}]},
  {...good,cards:[{...good.cards[0],expiresAt:Infinity}]},{...good,queued:61},{...good,rejected:{unknown:1}}])expect(parseMisskeyState(bad)).toBeNull();
});
test('replacement reconnects resubscribe, stale social frames stay inert, and malformed data clears visible state',()=>{
 const sockets:Socket[]=[],client=new StudioClient(()=>{const s=new Socket();sockets.push(s);return s as unknown as WebSocket;},()=> 'ws://localhost/ws');
 try{
  client.watchMisskey();client.connect();const first=sockets[0]!;first.receive({type:'hello'});
  expect(first.sent.filter(x=>x.includes('misskey-subscribe'))).toHaveLength(1);
  first.receive({type:'misskey',state:state()});expect(client.misskey?.cards).toHaveLength(1);const late=first.onmessage!;
  client.connect();expect(client.misskey).toBeNull();sockets[1]!.receive({type:'hello'});
  expect(sockets[1]!.sent.filter(x=>x.includes('misskey-subscribe'))).toHaveLength(1);
  late.call(first as unknown as WebSocket,{data:JSON.stringify({type:'misskey',state:state()})} as MessageEvent);expect(client.misskey).toBeNull();
  sockets[1]!.receive({type:'misskey',state:state()});expect(client.misskey?.cards).toHaveLength(1);
  sockets[1]!.receive({type:'misskey',state:{cards:[]}});expect(client.misskey).toBeNull();
 }finally{client.disconnect();}
});
test('old settings GET response cannot populate a replacement connection even if a fetch ignores AbortSignal',async()=>{
 const client=new StudioClient(()=>new Socket() as unknown as WebSocket,()=> 'ws://localhost/ws');const original=globalThis.fetch;
 let resolve!:(r:Response)=>void;globalThis.fetch=(()=>new Promise<Response>(done=>{resolve=done;})) as unknown as typeof fetch;
 try{
  client.connect();const result=client.misskeySettings();client.connect();resolve(Response.json({generation:9,settings:{}}));
  await expect(result).rejects.toThrow('接続が切り替わりました');
 }finally{globalThis.fetch=original;client.disconnect();}
});
