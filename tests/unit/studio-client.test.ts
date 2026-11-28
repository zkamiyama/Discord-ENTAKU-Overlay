import {expect,test} from 'bun:test';
import {StatePublisher} from '../../src/contracts/state-stream.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {StudioClient} from '../../src/web/shared/client.ts';

class FakeSocket {
  readyState=1;
  onmessage: WebSocket['onmessage']=null;
  onclose: WebSocket['onclose']=null;
  onerror:WebSocket['onerror']=null;
  sent:string[]=[];
  constructor(private readonly closes=true){}
  close():void {this.readyState=3;if(this.closes)this.end(1000);}
  send(value:string):void {this.sent.push(value);}
  receive(value:unknown):void {this.onmessage?.call(this as unknown as WebSocket,{data:JSON.stringify(value)} as MessageEvent);}
  end(code=1006):void {this.onclose?.call(this as unknown as WebSocket,{code} as CloseEvent);}
}
function fixture(staleMs=10_000,closes=true){
  const sockets:FakeSocket[]=[];
  const client=new StudioClient(()=>{const s=new FakeSocket(closes);sockets.push(s);return s as unknown as WebSocket;},()=> 'ws://127.0.0.1/test',5,staleMs);
  return {client,sockets};
}
function synchronize(socket:FakeSocket):void{
 socket.receive({type:'hello'});
 socket.receive(JSON.parse(new StatePublisher().publish(new AppEngine({source:'demo',serverEpoch:'test'}).snapshot()).full()));
}
test('late events from a replaced WebSocket cannot reset state or create reconnects',async()=>{
  const {client,sockets}=fixture();
  try{
    client.connect();const first=sockets[0]!;synchronize(first);expect(client.connected).toBe(true);
    const delayedClose=first.onclose!,delayedMessage=first.onmessage!;
    client.connect();const second=sockets[1]!;synchronize(second);const expected=client.state;
    delayedClose.call(first as unknown as WebSocket,{code:1006} as CloseEvent);
    delayedMessage.call(first as unknown as WebSocket,{data:JSON.stringify({type:'snapshot',state:{protocolVersion:1,serverEpoch:'old'}})} as MessageEvent);
    await Bun.sleep(20);expect(client.connected).toBe(true);expect(client.state).toBe(expected);expect(sockets).toHaveLength(2);
  }finally{client.disconnect();}
});
test('disconnect cancels scheduled reconnect and fresh connection restores chat subscription',async()=>{
  const {client,sockets}=fixture();
  try{
    client.watchChat();client.connect();sockets[0]!.receive({type:'hello'});expect(sockets[0]!.sent.some(x=>x.includes('vc-chat-subscribe'))).toBe(true);
    sockets[0]!.end();client.disconnect();await Bun.sleep(20);expect(sockets).toHaveLength(1);expect(client.connected).toBe(false);
    client.connect();sockets[1]!.receive({type:'hello'});expect(sockets[1]!.sent.some(x=>x.includes('vc-chat-subscribe'))).toBe(true);
  }finally{client.disconnect();}
});
test('a current connection retries once and policy closes never reconnect',async()=>{
  const {client,sockets}=fixture();
  try{
    client.connect();const first=sockets[0]!;first.end();first.end();
    for(let i=0;i<40&&sockets.length<2;i++)await Bun.sleep(5);
    expect(sockets).toHaveLength(2);sockets[1]!.end(1008);await Bun.sleep(20);expect(sockets).toHaveLength(2);
  }finally{client.disconnect();}
});

test('a socket without hello times out and reconnects, then accepts a new hello',async()=>{
  const {client,sockets}=fixture(25);
  try{
    client.connect();
    // Non-hello messages cannot keep the handshake alive forever.
    sockets[0]!.receive({type:'pong',clientTime:0,serverTime:0});
    for(let i=0;i<100&&sockets.length<2;i++)await Bun.sleep(5);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    synchronize(sockets.at(-1)!);
    expect(client.connected).toBe(true);
  }finally{client.disconnect();}
});
test('an established socket also reconnects after becoming silent',async()=>{
  const {client,sockets}=fixture(25);
  try{
    client.connect();synchronize(sockets[0]!);
    expect(client.connected).toBe(true);
    for(let i=0;i<100&&sockets.length<2;i++)await Bun.sleep(5);
    expect(sockets.length).toBeGreaterThanOrEqual(2);expect(client.connected).toBe(false);
  }finally{client.disconnect();}
});

test('a delta gap disables commands, requests one full resync and recovers',async()=>{
 const {client,sockets}=fixture();
 const sender=new StatePublisher(),state=new AppEngine({source:'demo',serverEpoch:'test'}).snapshot();
 try{
  client.connect();const socket=sockets[0]!;socket.receive({type:'hello'});
  socket.receive(JSON.parse(sender.publish(state).full()));
  sender.publish({...state,serverNowMs:100});
  const later=sender.publish({...state,serverNowMs:200});
  socket.receive(JSON.parse(later.delta!));socket.receive(JSON.parse(later.delta!));
  expect(client.connected).toBe(false);
  await expect(client.command({type:'wide'})).rejects.toThrow('サーバーとの接続を確認してください');
  expect(client.state?.serverNowMs).toBe(state.serverNowMs);
  expect(socket.sent.filter(s=>s.includes('"type":"resync"'))).toHaveLength(1);
  socket.receive(JSON.parse(later.full()));expect(client.state?.serverNowMs).toBe(200);expect(client.connected).toBe(true);
  const newest=sender.publish({...state,serverNowMs:300});socket.receive(JSON.parse(newest.delta!));
  expect(client.state?.serverNowMs).toBe(300);
 }finally{client.disconnect();}
});

test('hello alone and snapshots arriving before hello cannot enable commands',async()=>{
 const {client,sockets}=fixture();
 const packet=JSON.parse(new StatePublisher().publish(new AppEngine({source:'demo',serverEpoch:'test'}).snapshot()).full());
 try{
  client.connect();const socket=sockets[0]!;
  socket.receive(packet);expect(client.state).toBeNull();expect(client.connected).toBe(false);
  socket.receive({type:'hello'});expect(client.connected).toBe(false);
  await expect(client.command({type:'wide'})).rejects.toThrow('サーバーとの接続を確認してください');
  socket.receive(packet);expect(client.connected).toBe(true);
 }finally{client.disconnect();}
});

test('watchdog reconnects even when an unresponsive socket never emits close',async()=>{
 const {client,sockets}=fixture(20,false);
 try{
  client.connect();synchronize(sockets[0]!);
  const old=sockets[0]!,delayed=old.onclose!;
  for(let i=0;i<100&&sockets.length<2;i++)await Bun.sleep(5);
  expect(sockets).toHaveLength(2);expect(client.connected).toBe(false);
  synchronize(sockets[1]!);delayed.call(old as unknown as WebSocket,{code:1008} as CloseEvent);
  expect(client.connected).toBe(true);expect(old.onmessage).toBeNull();expect(old.onclose).toBeNull();
 }finally{client.disconnect();}
});

test('duplicate full snapshots preserve scene identity and playback clock origin',async()=>{
 const {client,sockets}=fixture();let updates=0;
 const sender=new StatePublisher(),state=new AppEngine({source:'replay',serverEpoch:'test'}).snapshot();
 const packet=JSON.parse(sender.publish({...state,serverNowMs:500,clockRate:1}).full());
 try{
  client.onState=()=>updates++;client.connect();const socket=sockets[0]!;socket.receive({type:'hello'});socket.receive(packet);
  const before=client.state;await Bun.sleep(15);const clock=client.now();
  client.resync();expect(client.connected).toBe(false);socket.receive(packet);
  expect(client.connected).toBe(true);expect(client.state).toBe(before);expect(updates).toBe(1);expect(client.now()).toBeGreaterThanOrEqual(clock);
 }finally{client.disconnect();}
});

test('a command reply from a replaced connection cannot be reported as success',async()=>{
 const {client,sockets}=fixture(),original=globalThis.fetch;
 let resolve!:(value:Response)=>void,signal:AbortSignal|undefined;
 globalThis.fetch=((_input:unknown,init?:RequestInit)=>{signal=init?.signal??undefined;return new Promise<Response>(r=>{resolve=r;});}) as typeof fetch;
 try{
  client.connect();synchronize(sockets[0]!);const result=client.command({type:'wide'});
  client.connect();synchronize(sockets[1]!);expect(signal?.aborted).toBe(true);
  resolve(Response.json({ok:true}));await expect(result).rejects.toThrow('操作結果は再同期後の状態で確認してください');
  expect(sockets[1]!.sent.filter(value=>value.includes('resync'))).toHaveLength(0);
 }finally{globalThis.fetch=original;client.disconnect();}
});

test('malformed and unmatched pongs cannot corrupt the renderer clock',()=>{
 const {client,sockets}=fixture();
 try{
  client.connect();synchronize(sockets[0]!);const socket=sockets[0]!,before=client.now();
  socket.receive({type:'pong',clientTime:0,serverTime:'not-a-time'});
  socket.receive({type:'pong',clientTime:0,serverTime:-1e100});
  expect(Number.isFinite(client.now())).toBe(true);expect(client.now()).toBeGreaterThanOrEqual(before);
 }finally{client.disconnect();}
});

test('cancelling image decoding closes a late bitmap instead of publishing it',async()=>{
 const {client}=fixture(),originalFetch=globalThis.fetch,originalDecode=globalThis.createImageBitmap,abort=new AbortController();
 let resolve!:(bitmap:ImageBitmap)=>void,fetchSignal:AbortSignal|undefined,closed=0;
 globalThis.fetch=(async(_input:unknown,init?:RequestInit)=>{fetchSignal=init?.signal??undefined;return new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}});}) as typeof fetch;
 globalThis.createImageBitmap=(()=>new Promise<ImageBitmap>(done=>{resolve=done;})) as typeof createImageBitmap;
 try{
  const result=client.customImage('asset',abort.signal).catch(error=>error as Error);
  for(let i=0;i<10&&!resolve;i++)await Bun.sleep(1);
  expect(fetchSignal).toBe(abort.signal);expect(resolve).toBeFunction();
  abort.abort(Error('superseded'));resolve({close(){closed++;}} as ImageBitmap);
  expect(await result).toEqual(Error('superseded'));expect(closed).toBe(1);
 }finally{globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalDecode;client.disconnect();}
});

test('saved environment preview connects to its own stream and never sends commands or chat subscriptions',async()=>{
 const originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),originalFetch=globalThis.fetch;
 Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('https://127.0.0.1/overlay?environment=preview')});
 const socket=new FakeSocket();let url='',fetches=0;
 const client=new StudioClient(value=>{url=value;return socket as unknown as WebSocket;});
 globalThis.fetch=(async()=>{fetches++;throw new Error('UNEXPECTED_FETCH');}) as unknown as typeof fetch;
 try{
  client.watchChat();client.watchMisskey();client.connect();synchronize(socket);
  expect(url).toBe('wss://127.0.0.1/ws?environment=preview');expect(client.connected).toBe(true);
  expect(socket.sent.some(message=>/vc-chat-subscribe|misskey-subscribe/.test(message))).toBe(false);
  await expect(client.command({type:'wide'})).rejects.toThrow('ENVIRONMENT_PREVIEW_READ_ONLY');
  await expect(client.controlMisskey('clear')).rejects.toThrow('ENVIRONMENT_PREVIEW_READ_ONLY');
  await expect(client.importImage(new Blob())).rejects.toThrow('ENVIRONMENT_PREVIEW_READ_ONLY');
  await expect(client.exportEnvironment({theme:'dark',expectedRevision:0,expectedGeneration:0})).rejects.toThrow('ENVIRONMENT_PREVIEW_READ_ONLY');
  expect(fetches).toBe(0);
 }finally{
  globalThis.fetch=originalFetch;client.disconnect();
  if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else Reflect.deleteProperty(globalThis,'location');
 }
});

test('environment replies cannot outlive their connection or the selected archive',async()=>{
 const {client,sockets}=fixture(),originalFetch=globalThis.fetch;
 let resolve!:(response:Response)=>void,signal:AbortSignal|undefined;
 globalThis.fetch=((_url:unknown,init?:RequestInit)=>{signal=init?.signal??undefined;return new Promise<Response>(done=>{resolve=done;});}) as typeof fetch;
 try{
  const file=new File(['archive'],'environment.zip');client.connect();synchronize(sockets[0]!);
  const oldConnection=client.inspectEnvironment(file);client.connect();synchronize(sockets[1]!);expect(signal?.aborted).toBe(true);
  resolve(Response.json({summary:{},revision:0,generation:0}));await expect(oldConnection).rejects.toThrow('操作結果は再同期後の状態で確認してください');
  const selection=new AbortController(),oldSelection=client.inspectEnvironment(file,selection.signal);
  selection.abort(new Error('ARCHIVE_SELECTION_CHANGED'));expect(signal?.aborted).toBe(true);
  resolve(Response.json({summary:{},revision:0,generation:0}));await expect(oldSelection).rejects.toThrow('ARCHIVE_SELECTION_CHANGED');
 }finally{globalThis.fetch=originalFetch;client.disconnect();}
});

test('saved standard icons use local assets and retain the Discord icon texture orientation',async()=>{
 const {client}=fixture(),originalFetch=globalThis.fetch,originalDecode=globalThis.createImageBitmap;
 const urls:string[]=[],orientations:(ImageOrientation|undefined)[]=[];
 globalThis.fetch=(async(input:unknown)=>{urls.push(String(input));return new Response(new Uint8Array([1]));}) as typeof fetch;
 globalThis.createImageBitmap=(async(_blob:ImageBitmapSource,options?:ImageBitmapOptions)=>{orientations.push(options?.imageOrientation);return {close(){}} as ImageBitmap;}) as typeof createImageBitmap;
 try{
  await client.avatar('100',undefined,'a'.repeat(64));await client.avatar('100');
  expect(urls).toEqual(['/api/assets/'+'a'.repeat(64),'/api/avatars/100']);expect(orientations).toEqual(['flipY','flipY']);
 }finally{globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalDecode;client.disconnect();}
});
