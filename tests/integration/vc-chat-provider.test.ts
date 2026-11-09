import {expect,test} from 'bun:test';
import {createServer,type Socket} from 'node:net';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FrameDecoder,decodeObject,encodeFrame,encodeJson,Op} from '../../src/discord/codec.ts';
import {IpcVoiceProvider} from '../../src/discord/ipc-voice-provider.ts';
import type {ProviderEvent} from '../../src/contracts/domain.ts';
const until=async(predicate:()=>boolean,ms=8000)=>{const deadline=performance.now()+ms;while(!predicate()){if(performance.now()>deadline)throw Error('PROBE_TEST_TIMEOUT');await Bun.sleep(10);}};
async function mock(rejectFirst:boolean){
 const path=process.platform==='win32'?`\\\\.\\pipe\\entaku-chat-${randomUUID()}`:join(tmpdir(),`ec-${randomUUID()}.sock`);
 let channel='200',connections=0;const sockets=new Set<Socket>(),requests:Record<string,unknown>[]=[];
 const dispatch=(evt:string,data:unknown)=>{for(const socket of sockets)socket.write(encodeJson(Op.FRAME,{cmd:'DISPATCH',evt,data}));};
 const server=createServer(socket=>{
  connections++;const number=connections;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const decoder=new FrameDecoder();
  socket.on('data',chunk=>{for(const frame of decoder.push(Buffer.from(chunk))){
   if(frame.opcode===Op.HANDSHAKE){socket.write(encodeJson(Op.FRAME,{cmd:'DISPATCH',evt:'READY',data:{v:1}}));continue;}
   if(frame.opcode===Op.PING){socket.write(encodeFrame(Op.PONG,frame.payload));continue;}
   const request=decodeObject(frame.payload);requests.push(request);
   if(request.cmd==='SUBSCRIBE'&&request.evt==='MESSAGE_CREATE'){
    if(rejectFirst&&number===1){socket.write(encodeJson(Op.FRAME,{cmd:request.cmd,evt:'ERROR',nonce:request.nonce,data:{code:5001,message:'PRIVATE_ERROR_TOKEN'}}));continue;}
    // A real JSON DISPATCH arriving BEFORE the SUBSCRIBE response must not be lost.
    socket.write(encodeJson(Op.FRAME,{cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:channel,message:{id:String(number*100),author:{id:'102',username:'test-user'},content:'TEST_MESSAGE',timestamp:new Date().toISOString()}}}));
   }
   const data=['GET_SELECTED_VOICE_CHANNEL','GET_CHANNEL'].includes(String(request.cmd))?
    {id:channel,type:2,guild_id:'300',name:'Fixture VC',messages:[{content:'PRIVATE_HISTORY_BODY'}],voice_states:[{user:{id:'101',username:'voice-user'},voice_state:{}}]}:
    request.cmd==='SUBSCRIBE'?{evt:request.evt}:{};
   socket.write(encodeJson(Op.FRAME,{cmd:request.cmd,nonce:request.nonce,data}));
  }});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
 return {path,requests,dispatch,sockets,get connections(){return connections;},move(){channel='201';dispatch('VOICE_CHANNEL_SELECT',{channel_id:channel});},
  reconnect(){for(const socket of sockets)socket.destroy();},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
function provider(path:string,events:ProviderEvent[],lines:string[]){
 const old=process.env.ENTAKU_PROBE_VC_CHAT;process.env.ENTAKU_PROBE_VC_CHAT='1';
 try{return new IpcVoiceProvider({clientId:'123',authenticate:async()=>{},clear(){},probeInfo:()=>({requestedScopes:['rpc','rpc.voice.read'],grantedScopes:['rpc','rpc.voice.read'],userId:'101'})},e=>events.push(e),undefined,[path],{log:l=>lines.push(l),testMessage:'TEST_MESSAGE',metadataOnly:true});}
 finally{if(old===undefined)delete process.env.ENTAKU_PROBE_VC_CHAT;else process.env.ENTAKU_PROBE_VC_CHAT=old;}
}
test('rejected chat subscription does not stop voice; moving VC and reconnecting re-subscribe',async()=>{
 const peer=await mock(true),events:ProviderEvent[]=[],lines:string[]=[],p=provider(peer.path,events,lines);
 try{
  p.start();await until(()=>events.some(e=>e.type==='connection'&&e.status==='ready')&&p.chatProbeSummary()?.subscription==='failed');
  expect(p.chatProbeSummary()).toMatchObject({rpcCode:5001,historyCount:1,matchedEvents:0});
  expect(peer.requests.findIndex(r=>r.cmd==='GET_CHANNEL')).toBeLessThan(peer.requests.findIndex(r=>r.evt==='MESSAGE_CREATE'));
  expect(lines.findIndex(l=>l.includes('GET_CHANNEL messages='))).toBeLessThan(lines.findIndex(l=>l.includes('SUBSCRIBE_MESSAGE_CREATE failed')));
  peer.dispatch('SPEAKING_START',{channel_id:'200',user_id:'101'});
  peer.dispatch('MESSAGE_CREATE',null); // even a malformed diagnostic event cannot close voice RPC
  await until(()=>events.some(e=>e.type==='speaking'&&e.state==='active'));expect(peer.connections).toBe(1);
  peer.move();await until(()=>p.chatProbeSummary()?.verifiedTestEvents===1&&events.some(e=>e.type==='snapshot'&&e.channel?.channelId==='201'));
  const chatRequests=peer.requests.filter(p=>p.evt==='MESSAGE_CREATE');expect(chatRequests.map(p=>(p.args as any).channel_id)).toEqual(['200','201']);
  peer.dispatch('MESSAGE_CREATE',{channel_id:'200',message:{author:{id:'102'},content:'WRONG_CHANNEL_SECRET',timestamp:new Date().toISOString()}});
  await Bun.sleep(30);expect(p.chatProbeSummary()?.ignoredChannelEvents).toBe(1);
  peer.reconnect();await until(()=>p.chatProbeSummary()?.verifiedTestEvents===2&&p.chatProbeSummary()?.subscription==='success');
  expect(peer.requests.filter(p=>p.evt==='MESSAGE_CREATE').map(p=>(p.args as any).channel_id)).toEqual(['200','201','201']);
  expect(JSON.stringify(events)).not.toContain('TEST_MESSAGE');expect(lines.join('\n')).not.toMatch(/PRIVATE_|WRONG_CHANNEL_SECRET|voice-user|test-user/);
  const allowed=new Set(['SUBSCRIBE','GET_SELECTED_VOICE_CHANNEL','GET_CHANNEL']);expect(peer.requests.every(r=>allowed.has(String(r.cmd)))).toBe(true);
 }finally{await p.stop();await peer.close();}
});

test('default production chat delivers IPC posts independently of camera events without probe or additional scopes',async()=>{
 const previous=process.env.ENTAKU_PROBE_VC_CHAT;delete process.env.ENTAKU_PROBE_VC_CHAT;
 const peer=await mock(false),events:ProviderEvent[]=[];
 const p=new IpcVoiceProvider({clientId:'123',authenticate:async()=>{},clear(){}},e=>events.push(e),undefined,[peer.path]);
 try{
  p.start();await until(()=>p.vcChat.snapshot().status==='live'&&p.vcChat.snapshot().deletions===true);
  expect(p.chatProbeSummary()).toBeUndefined();expect(p.vcChat.snapshot().messages[0]?.content).toBe('TEST_MESSAGE');
  expect(peer.requests.filter(r=>r.evt==='MESSAGE_CREATE')).toHaveLength(1);
  peer.dispatch('MESSAGE_UPDATE',{channel_id:'200',message:{id:'100',content:'EDITED',edited_timestamp:new Date().toISOString()}});
  await until(()=>p.vcChat.snapshot().messages[0]?.content==='EDITED');
  peer.dispatch('MESSAGE_DELETE',{channel_id:'200',message:{id:'100'}});await until(()=>p.vcChat.snapshot().messages.length===0);
  peer.dispatch('SPEAKING_START',{channel_id:'200',user_id:'101'});await until(()=>events.some(e=>e.type==='speaking'));
  expect(JSON.stringify(events)).not.toMatch(/TEST_MESSAGE|EDITED/);
  peer.move();await until(()=>p.vcChat.snapshot().channelId==='201'&&p.vcChat.snapshot().status==='live');
  expect(p.vcChat.snapshot().messages.every(m=>m.channelId==='201')).toBe(true);
 }finally{await p.stop();await peer.close();if(previous===undefined)delete process.env.ENTAKU_PROBE_VC_CHAT;else process.env.ENTAKU_PROBE_VC_CHAT=previous;}
});
