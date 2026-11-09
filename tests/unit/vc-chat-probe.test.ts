import {expect,test} from 'bun:test';
import {VcChatProbe,createVcChatProbe,terminalText} from '../../src/discord/vc-chat-probe.ts';
import {DiscordError} from '../../src/discord/errors.ts';
import {StreamKitCompatAuth} from '../../src/discord/auth-provider.ts';
import {parseProbeArguments} from '../../scripts/probe-vc-chat.ts';
const selection={id:'200',type:2,guild_id:'300'};
const stamp=new Date(1000).toISOString();
const event=(channel='200',content='TEST',userId='101',nested?:string)=>({cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:channel,message:{id:'999',...(nested?{channel_id:nested}:{}),author:{id:userId,username:'tester'},content,timestamp:stamp}}});
function fixture(response:unknown={evt:'MESSAGE_CREATE'},log?:(line:string)=>void){
 const lines:string[]=[],listeners=new Set<(p:any)=>void>(),requests:any[]=[];
 const probe=new VcChatProbe({utcNow:()=>1000,log:log??(l=>lines.push(l)),testMessage:'TEST'});
 probe.authenticated({requestedScopes:['rpc','rpc.voice.read'],grantedScopes:['rpc','rpc.voice.read'],userId:'100'});
 const rpc={onEvent:(f:(p:any)=>void)=>{listeners.add(f);return ()=>{listeners.delete(f);};},request:async(...args:any[])=>{requests.push(args);if(response instanceof Error)throw response;return response;}};
 const dispatch=(p:any)=>{for(const f of listeners)f(p);};
 return {probe,rpc,lines,requests,dispatch,listeners};
}
test('probe is inert unless the environment flag is exactly 1',()=>{
 for(const flag of [undefined,'','0','true'])expect(createVcChatProbe({log:()=>{throw Error();}},{ENTAKU_PROBE_VC_CHAT:flag})).toBeUndefined();
 expect(createVcChatProbe({log:()=>{}},{ENTAKU_PROBE_VC_CHAT:'1'})).toBeInstanceOf(VcChatProbe);
});
test('server VC selection only; history prints presence and count, never contents',async()=>{
 const f=fixture();f.probe.start(f.rpc,null);f.probe.start(f.rpc,{id:'200',type:3});expect(f.requests).toHaveLength(0);
 f.probe.start(f.rpc,selection);f.probe.inspectChannel({...selection,messages:[{content:'PRIVATE_HISTORY',author:{username:'PRIVATE_AUTHOR'}}]});await Bun.sleep(0);
 expect(f.requests).toEqual([['SUBSCRIBE',{channel_id:'200'},'MESSAGE_CREATE']]);expect(f.probe.summary()).toMatchObject({subscription:'success',historyCount:1,matchedEvents:0,verifiedTestEvents:0});
 expect(f.lines.join('\n')).not.toContain('PRIVATE_HISTORY');expect(f.lines.join('\n')).not.toContain('PRIVATE_AUTHOR');
});
test('MESSAGE_CREATE is registered before subscribe ACK and uses envelope/nested channel checks',async()=>{
 const f=fixture();f.rpc.request=async(...args:any[])=>{f.requests.push(args);f.dispatch(event());return {evt:'MESSAGE_CREATE'};};
 f.probe.start(f.rpc,selection);await Bun.sleep(0);expect(f.probe.summary().verifiedTestEvents).toBe(1);
 f.dispatch(event('201','OTHER_CHANNEL'));f.dispatch(event('200','CONFLICT','101','202'));
 f.dispatch({cmd:'DISPATCH',evt:'MESSAGE_UPDATE',data:event().data});f.dispatch(event());
 expect(f.probe.summary().matchedEvents).toBe(1);expect(f.lines.join('\n')).not.toContain('OTHER_CHANNEL');expect(f.lines.join('\n')).not.toContain('CONFLICT');
 const fallback=event();delete (fallback.data as any).channel_id;(fallback.data.message as any).channel_id='200';fallback.data.message.id='1000';f.dispatch(fallback);expect(f.probe.summary().matchedEvents).toBe(2);
});
test('authored by self, stale timestamps, malformed events and absent identity cannot meet success',async()=>{
 const f=fixture();f.probe.start(f.rpc,selection);await Bun.sleep(0);
 f.dispatch(event('200','TEST','100'));expect(f.probe.summary().verifiedTestEvents).toBe(0);
 const old=event();old.data.message.timestamp=new Date(0).toISOString();f.dispatch(old);
 f.dispatch({cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:null});
 expect(f.probe.summary()).toMatchObject({staleEvents:1,malformedEvents:1,matchedEvents:1});
 f.probe.authenticated();const unknown=event();unknown.data.message.id='1001';f.dispatch(unknown);expect(f.probe.summary().verifiedTestEvents).toBe(0);
});
test('permission error exposes only numeric RPC code, and an output exception does not escape',async()=>{
 const f=fixture(new DiscordError('RPC_REJECTED',5001));f.probe.start(f.rpc,selection);await Bun.sleep(0);
 expect(f.probe.summary()).toMatchObject({subscription:'failed',rpcCode:5001,error:'RPC_REJECTED'});expect(f.listeners.size).toBe(0);
 const throwing=fixture({evt:'MESSAGE_CREATE'},()=>{throw new Error('SECRET');});throwing.probe.start(throwing.rpc,selection);await Bun.sleep(0);expect(()=>throwing.dispatch(event())).not.toThrow();
 const bad=fixture(new Error('PRIVATE_TOKEN'));bad.probe.start(bad.rpc,selection);await Bun.sleep(0);expect(bad.lines.join('\n')).not.toContain('PRIVATE_TOKEN');
});
test('disconnect ignores late subscribe completion; new channel resubscribes without old listener',async()=>{
 const f=fixture();let resolve!:(value:unknown)=>void;f.rpc.request=()=>new Promise(r=>{resolve=r;});f.probe.start(f.rpc,selection);f.probe.dispose();resolve({evt:'MESSAGE_CREATE'});await Bun.sleep(0);
 expect(f.probe.summary().subscription).toBe('pending');expect(f.listeners.size).toBe(0);
 f.rpc.request=async()=>({evt:'MESSAGE_CREATE'});f.probe.start(f.rpc,{...selection,id:'201'});await Bun.sleep(0);f.dispatch(event());f.dispatch(event('201'));expect(f.probe.summary()).toMatchObject({matchedEvents:1,ignoredChannelEvents:1,sessions:2});
});
test('metadata-only output contains no username or message; terminal controls are escaped',async()=>{
 const lines:string[]=[],f=fixture();const p=new VcChatProbe({log:l=>lines.push(l),metadataOnly:true,utcNow:()=>1000});p.start(f.rpc,selection);await Bun.sleep(0);f.dispatch(event('200','PRIVATE_TEXT'));
 expect(lines.join('\n')).not.toContain('PRIVATE_TEXT');expect(lines.join('\n')).not.toContain('tester');expect(lines.join('\n')).not.toContain('"200"');
 expect(terminalText('a\x1b[31m\n\rb')).not.toContain('\x1b');expect(terminalText('a\nb')).toBe('a\\nb');
});
test('auth diagnostic allowlist retains scopes and an in-memory ID, not credentials',async()=>{
 const rpc={request:async(cmd:string)=>cmd==='AUTHORIZE'?{code:'SECRET_CODE'}:{access_token:'SECRET_TOKEN',scopes:['rpc','rpc.voice.read'],user:{id:'100',username:'PRIVATE_NAME'},application:{description:'PRIVATE_APP'}};
 const auth=new StreamKitCompatAuth(true,async()=>Response.json({access_token:'SECRET_TOKEN'}));await auth.authenticate(rpc,true);
 expect(auth.probeInfo()).toEqual({requestedScopes:['rpc','rpc.voice.read'],grantedScopes:['rpc','rpc.voice.read'],userId:'100'});
 expect(JSON.stringify(auth.probeInfo())).not.toMatch(/SECRET|PRIVATE/);auth.clear();expect(auth.probeInfo().grantedScopes).toBeNull();
});
test('terminal runner accepts only bounded duration and explicit consent flags',()=>{
 expect(parseProbeArguments(['--seconds','10','--metadata-only','--accept-streamkit-compat'])).toMatchObject({seconds:10,metadataOnly:true,consent:true});
 for(const args of [['--seconds','0'],['--seconds'],['--seconds','999999'],['--extra-scope','messages.read']])expect(()=>parseProbeArguments(args)).toThrow();
});

test('an early test DISPATCH followed by rejected subscription cannot turn a later ACK into PASS',async()=>{
 const f=fixture();f.rpc.request=async()=>{f.dispatch(event());throw new DiscordError('RPC_REJECTED',5001);};
 f.probe.start(f.rpc,selection);await Bun.sleep(0);expect(f.probe.summary()).toMatchObject({subscription:'failed',matchedEvents:1,verifiedTestEvents:0});
 f.rpc.request=async()=>({evt:'MESSAGE_CREATE'});f.probe.start(f.rpc,selection);await Bun.sleep(0);expect(f.probe.summary()).toMatchObject({subscription:'success',verifiedTestEvents:0});
});
