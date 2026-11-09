import {DiscordError} from './errors.ts';
import type {AuthProbeInfo} from './auth-provider.ts';
import type {RpcClient} from './rpc-client.ts';

type Packet=Record<string,unknown>;
type ProbeRpc=Pick<RpcClient,'request'|'onEvent'>;
export interface VcChatProbeSummary {
 enabled:true;discordVersion:string;requestedScopes:string[];grantedScopes:string[]|null;
 selected:'not-queried'|'none'|'unsupported'|'guild-voice';sessions:number;
 historyMessages:'not-inspected'|'absent'|'array'|'invalid';historyCount:number|null;
 subscription:'not-attempted'|'pending'|'success'|'failed';
 error:string|null;rpcCode:number|null;matchedEvents:number;otherAuthorEvents:number;
 verifiedTestEvents:number;ignoredChannelEvents:number;malformedEvents:number;staleEvents:number;
 lastFailureStage:string|null;
}
export interface VcChatProbeOptions {
 log?:(line:string)=>void;
 /** Headless diagnostics must not collect real chat in remote-tool output. */
 metadataOnly?:boolean;
 /** The operator posts this exact synthetic message from another account. */
 testMessage?:string;
 discordVersion?:string;
 utcNow?:()=>number;
}
const record=(v:unknown):Packet|null=>!!v&&typeof v==='object'&&!Array.isArray(v)?v as Packet:null;
const snowflake=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,20}$/.test(v);
// No escape sequences, newlines, bidi overrides or terminal command injection.
export const terminalText=(v:string,max=4000):string=>v.slice(0,max).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,c=>c==='\n'?'\\n':c==='\r'?'\\r':'?');
export function safeProbeError(error:unknown):{error:string;rpcCode:number|null} {
 return {error:error instanceof DiscordError&&/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code)?error.code:'PROBE_INTERNAL_ERROR',
  rpcCode:error instanceof DiscordError&&Number.isSafeInteger(error.rpcCode)?error.rpcCode!:null};
}
/** Console-only diagnostic. Nothing here is a ProviderEvent, recording, API or persisted value. */
export class VcChatProbe {
 private off:(()=>void)|null=null;private channel:string|null=null;private userId:string|undefined;
 private connection=0;private startedAt=0;private pendingVerified=0;private seen=new Set<string>();
 private readonly utcNow:()=>number;
 private state:VcChatProbeSummary;
 constructor(private options:VcChatProbeOptions={}){
  this.utcNow=options.utcNow??Date.now;
  const version=options.discordVersion;
  this.state={enabled:true,discordVersion:typeof version==='string'&&/^[A-Za-z0-9 ._()+-]{1,100}$/.test(version)?version:'not-reported',
   requestedScopes:[],grantedScopes:null,selected:'not-queried',sessions:0,historyMessages:'not-inspected',historyCount:null,
   subscription:'not-attempted',error:null,rpcCode:null,matchedEvents:0,otherAuthorEvents:0,verifiedTestEvents:0,
   ignoredChannelEvents:0,malformedEvents:0,staleEvents:0,lastFailureStage:null};
  this.line('ENABLED terminal-only; no history contents, tokens, raw auth, or persistence');
  this.line(`discord_version=${this.state.discordVersion} (RPC READY.v is not a client build)`);
 }
 summary():VcChatProbeSummary{return structuredClone(this.state);}
 private line(text:string):void {try{(this.options.log??console.log)(`[VC-CHAT-PROBE] ${text}`);}catch{/* Diagnostic output cannot interrupt voice handling. */}}
 authorizing(info?:AuthProbeInfo):void{
  this.state.requestedScopes=[...(info?.requestedScopes??[])];this.state.grantedScopes=null;this.userId=undefined;
  this.line(`authorizing requested_scopes=${this.state.requestedScopes.join(',')||'unknown'}`);
 }
 authenticated(info?:AuthProbeInfo):void{
  this.userId=info?.userId;
  this.state.requestedScopes=[...(info?.requestedScopes??[])];this.state.grantedScopes=info?.grantedScopes?[...info.grantedScopes]:null;
  this.line(`authenticated requested_scopes=${this.state.requestedScopes.join(',')||'unknown'} granted_scopes=${this.state.grantedScopes?.join(',')??'not-reported'}`);
 }
 failure(stage:string,error:unknown):void {
  const safe=safeProbeError(error);this.state.error=safe.error;this.state.rpcCode=safe.rpcCode;this.state.lastFailureStage=stage;
  this.line(`${stage} failed code=${safe.error} rpc_code=${safe.rpcCode??'unavailable'}`);
 }
 /** Register before SUBSCRIBE, including when a peer dispatches before its ACK. */
 start(client:ProbeRpc,selection:unknown,channelSnapshot?:unknown,subscription?:Promise<unknown>):void{
  this.dispose();const selected=record(selection);
  this.state.subscription='not-attempted';this.state.historyMessages='not-inspected';this.state.historyCount=null;
  this.state.error=null;this.state.rpcCode=null;this.state.lastFailureStage=null;
  if(selection===null){this.state.selected='none';this.line('selected=none; join a server VC');return;}
  if(!selected||selected.type!==2||!snowflake(selected.id)){this.state.selected='unsupported';this.line('selected=unsupported; only type=2 server VC is tested');return;}
  const channel=selected.id,connection=++this.connection;
  this.channel=channel;this.startedAt=this.utcNow();this.state.sessions++;this.state.selected='guild-voice';this.state.subscription='pending';
  this.line(`session=${this.state.sessions} selected=type:2 (channel ID retained only in memory)`);
  if(channelSnapshot!==undefined)this.inspectChannel(channelSnapshot);
  this.off=client.onEvent(packet=>{try{this.message(packet);}catch{this.state.malformedEvents++;this.line('MESSAGE_CREATE malformed; ignored');}});
  void (async()=>{
   try{
    const response=await (subscription??client.request('SUBSCRIBE',{channel_id:channel},'MESSAGE_CREATE'));
    if(connection!==this.connection)return;
    if(record(response)?.evt!=='MESSAGE_CREATE')throw new DiscordError('PROBE_SUBSCRIBE_ACK_INVALID');
    this.state.subscription='success';this.state.verifiedTestEvents+=this.pendingVerified;this.pendingVerified=0;this.line('SUBSCRIBE MESSAGE_CREATE success; awaiting a new post (not a test PASS)');
   }catch(error){if(connection!==this.connection)return;this.state.subscription='failed';this.failure('SUBSCRIBE_MESSAGE_CREATE',error);this.off?.();this.off=null;}
  })();
 }
 /** Inspect only presence/length, never the objects in the history array. */
 inspectChannel(raw:unknown):void{
  try{
   const channel=record(raw);if(!channel||channel.id!==this.channel||channel.type!==2)return;
   const exists=Object.hasOwn(channel,'messages'),array=Array.isArray(channel.messages);
   this.state.historyMessages=!exists?'absent':array?'array':'invalid';this.state.historyCount=array?(channel.messages as unknown[]).length:null;
   this.line(`GET_CHANNEL messages=${this.state.historyMessages} count=${this.state.historyCount??'unavailable'}`);
  }catch{this.line('GET_CHANNEL messages inspection failed; voice processing unchanged');}
 }
 private message(packet:Packet):void{
  if(packet.cmd!=='DISPATCH'||packet.evt!=='MESSAGE_CREATE'||!this.channel)return;
  const data=record(packet.data),message=record(data?.message);
  if(!data||!message){this.state.malformedEvents++;return;}
  // The envelope is authoritative when present. Nested ID must not conflict.
  const outer=data.channel_id,inner=message.channel_id,channel=outer??inner;
  if(!snowflake(channel)||channel!==this.channel||(outer!==undefined&&outer!==null&&inner!==undefined&&inner!==null&&outer!==inner)){
   this.state.ignoredChannelEvents++;return;
  }
  const author=record(message.author),timestamp=message.timestamp;
  if(!author||!snowflake(author.id)||typeof message.content!=='string'||typeof timestamp!=='string'||!Number.isFinite(Date.parse(timestamp))){this.state.malformedEvents++;return;}
  // Historical GET_CHANNEL data is never passed here. Ignore stale DISPATCHes too.
  if(Date.parse(timestamp)<this.startedAt){this.state.staleEvents++;return;}
  if(snowflake(message.id)){if(this.seen.has(message.id))return;if(this.seen.size>=256)this.seen.delete(this.seen.values().next().value!);this.seen.add(message.id);}
  const other=this.userId!==undefined&&author.id!==this.userId;
  this.state.matchedEvents++;if(other)this.state.otherAuthorEvents++;
  const isTest=this.options.testMessage!==undefined&&message.content===this.options.testMessage&&other&&author.bot!==true;
  if(isTest){if(this.state.subscription==='success')this.state.verifiedTestEvents++;else this.pendingVerified++;}
  const time=new Date(timestamp).toLocaleTimeString('ja-JP',{hour12:false});
  const name=typeof author.username==='string'?author.username:typeof author.global_name==='string'?author.global_name:'(author unavailable)';
  if(!this.options.metadataOnly){
   try{(this.options.log??console.log)(`[${time}] [VC] ${terminalText(name,100)}: ${terminalText(message.content)}`);}catch{}
  }
  this.line(`MESSAGE_CREATE channel_match=true timestamp=${new Date(timestamp).toISOString()} other_author=${this.userId===undefined?'unknown':other} test_marker=${isTest?'matched':'unverified'}`);
 }
 dispose():void {++this.connection;this.off?.();this.off=null;this.channel=null;this.pendingVerified=0;this.seen.clear();}
}
export function createVcChatProbe(options?:VcChatProbeOptions,env:Record<string,string|undefined>=process.env):VcChatProbe|undefined{
 return env.ENTAKU_PROBE_VC_CHAT==='1'?new VcChatProbe({...options,discordVersion:options?.discordVersion??env.ENTAKU_PROBE_DISCORD_VERSION}):undefined;
}
