import {expect,test} from 'bun:test';
import {StudioClient} from '../../src/web/shared/client.ts';

class FakeSocket {
  readyState=1;
  onmessage: WebSocket['onmessage']=null;
  onclose: WebSocket['onclose']=null;
  sent:string[]=[];
  close():void {this.readyState=3;this.end(1000);}
  send(value:string):void {this.sent.push(value);}
  receive(value:unknown):void {this.onmessage?.call(this as unknown as WebSocket,{data:JSON.stringify(value)} as MessageEvent);}
  end(code=1006):void {this.onclose?.call(this as unknown as WebSocket,{code} as CloseEvent);}
}
function fixture(){
  const sockets:FakeSocket[]=[];
  const client=new StudioClient(()=>{const s=new FakeSocket();sockets.push(s);return s as unknown as WebSocket;},()=> 'ws://127.0.0.1/test',5);
  return {client,sockets};
}
test('late events from a replaced WebSocket cannot reset state or create reconnects',async()=>{
  const {client,sockets}=fixture();
  try{
    client.connect();const first=sockets[0]!;first.receive({type:'hello'});expect(client.connected).toBe(true);
    const delayedClose=first.onclose!,delayedMessage=first.onmessage!;
    client.connect();const second=sockets[1]!;second.receive({type:'hello'});
    delayedClose.call(first as unknown as WebSocket,{code:1006} as CloseEvent);
    delayedMessage.call(first as unknown as WebSocket,{data:JSON.stringify({type:'snapshot',state:{protocolVersion:1,serverEpoch:'old'}})} as MessageEvent);
    await Bun.sleep(20);expect(client.connected).toBe(true);expect(client.state).toBeNull();expect(sockets).toHaveLength(2);
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
