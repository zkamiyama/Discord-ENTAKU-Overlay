import {CHAT_LIMIT,CHAT_BYTE_LIMIT,emptyVcChat,type VcChatMessage,type VcChatState,type VcChatStatus} from '../contracts/vc-chat.ts';
import type {RpcClient} from '../discord/rpc-client.ts';
import {DiscordError} from '../discord/errors.ts';
type Packet=Record<string,unknown>;
type ChatRpc=Pick<RpcClient,'request'|'onEvent'>;
const record=(value:unknown):Packet|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Packet:null;
const id=(value:unknown):value is string=>typeof value==='string'&&/^\d{1,20}$/.test(value);
const text=(value:string,limit:number)=>value.slice(0,limit).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'');
const date=(value:unknown):string|null=>typeof value==='string'&&value.length<80&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
function normalize(raw:unknown,channelId:string,previous?:VcChatMessage):VcChatMessage|null {
  const m=record(raw);if(!m||!id(m.id)||m.blocked===true||(m.channel_id!=null&&m.channel_id!==channelId))return null;
  const a=record(m.author),member=record(m.member),authorId=a?.id??previous?.authorId;
  if(!id(authorId))return null;
  const name=[member?.nick,m.nick,a?.global_name,a?.username,previous?.authorName].find(v=>typeof v==='string'&&v.length) as string|undefined;
  const timestamp=date(m.timestamp)??previous?.timestamp;if(!timestamp||!name)return null;
  const content=typeof m.content==='string'?m.content:previous?.content;
  if(content===undefined)return null;
  return {id:m.id,channelId,authorId,authorName:text(name,100),content:text(content,4000),timestamp,
    editedTimestamp:m.edited_timestamp===undefined?previous?.editedTimestamp??null:date(m.edited_timestamp),
    attachmentCount:Array.isArray(m.attachments)?Math.min(100,m.attachments.length):previous?.attachmentCount??0,
    truncated:content.length>4000||(m.content===undefined&&previous?.truncated===true)};
}
/** One selected VC, bounded RAM only. Errors cannot interrupt the voice session. */
export class VcChatFeed {
  private state:VcChatState;
  private listeners=new Set<(state:VcChatState)=>void>();
  private off:(()=>void)|null=null;private generation=0;
  // Live changes win over GET_CHANNEL responses already in flight.
  private touched=new Set<string>();private deleted=new Set<string>();
  constructor(status:VcChatStatus='connecting',private readonly sinceUtcMs=Date.now()){this.state=emptyVcChat(status);}
  snapshot():VcChatState{return structuredClone(this.state);}
  observe(listener:(state:VcChatState)=>void):()=>void{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private publish():void {
    this.state.revision++;
    for(const listener of this.listeners)try{listener(this.snapshot());}catch{/* A UI consumer must not close RPC. */}
  }
  disconnect(status:VcChatStatus='disconnected'):void {
    ++this.generation;this.off?.();this.off=null;this.touched.clear();this.deleted.clear();
    const revision=this.state.revision;this.state={...emptyVcChat(status),revision};this.publish();
  }
  /** Returns the CREATE subscription so the optional terminal probe shares it. */
  start(client:ChatRpc,selection:unknown,rawChannel?:unknown):Promise<unknown>|undefined {
    this.disconnect('subscribing');const channel=record(selection);
    if(selection===null){this.state.status='no-channel';this.publish();return;}
    if(!channel||channel.type!==2||!id(channel.id)){this.state.status='unsupported';this.publish();return;}
    const generation=this.generation;
    this.state.channelId=channel.id;this.state.channelName=typeof channel.name==='string'?text(channel.name,100):'VC';
    this.mergeHistory(rawChannel);
    this.off=client.onEvent(packet=>{if(generation!==this.generation)return;try{this.receive(packet);}catch{/* Reject malformed chat without affecting voice. */}});
    this.publish();
    const subscribed=client.request('SUBSCRIBE',{channel_id:channel.id},'MESSAGE_CREATE').then(raw=>{
      if(record(raw)?.evt!=='MESSAGE_CREATE')throw new DiscordError('CHAT_SUBSCRIBE_ACK_INVALID');return raw;
    });
    void subscribed.then(async()=>{
      if(generation!==this.generation)return;
      this.state.status='live';this.publish();
      for(const [event,field] of [['MESSAGE_UPDATE','updates'],['MESSAGE_DELETE','deletions']] as const){
        if(generation!==this.generation)return;
        let supported=false;
        try{supported=record(await client.request('SUBSCRIBE',{channel_id:channel.id},event))?.evt===event;}catch{/* New messages still work without optional events. */}
        if(generation!==this.generation)return;
        this.state[field]=supported;this.publish();
      }
    }).catch(error=>{
      if(generation!==this.generation)return;
      this.state.status='error';this.state.errorCode=error instanceof DiscordError&&/^[A-Z_0-9]{1,80}$/.test(error.code)?error.code:'CHAT_SUBSCRIBE_FAILED';
      this.state.rpcCode=error instanceof DiscordError&&Number.isSafeInteger(error.rpcCode)?error.rpcCode!:null;
      this.off?.();this.off=null;this.publish();
    });
    return subscribed;
  }
  /** The existing voice GET_CHANNEL supplies a limited history; no extra polling. */
  mergeHistory(raw:unknown):void {
    const channel=record(raw),channelId=this.state.channelId;
    if(!channelId||channel?.id!==channelId||channel.type!==2||!Array.isArray(channel.messages))return;
    const before=JSON.stringify(this.state.messages),messages=new Map(this.state.messages.map(m=>[m.id,m]));
    for(const rawMessage of channel.messages.slice(0,500)){
      const message=normalize(rawMessage,channelId);if(!message||Date.parse(message.timestamp)<this.sinceUtcMs||this.touched.has(message.id))continue;
      messages.set(message.id,message);
    }
    this.replace([...messages.values()]);if(JSON.stringify(this.state.messages)!==before)this.publish();
  }
  private replace(messages:VcChatMessage[]):void {
    messages.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||(a.id.length-b.id.length)||a.id.localeCompare(b.id));
    this.state.messages=messages.slice(-CHAT_LIMIT);
    let size=0;const keep:VcChatMessage[]=[];
    for(let i=this.state.messages.length-1;i>=0;i--){const message=this.state.messages[i]!;size+=Buffer.byteLength(JSON.stringify(message));if(size>CHAT_BYTE_LIMIT)break;keep.push(message);}
    this.state.messages=keep.reverse();
  }
  private receive(packet:Packet):void {
    if(packet.cmd!=='DISPATCH'||!['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE'].includes(String(packet.evt))||!this.state.channelId)return;
    const data=record(packet.data),m=record(data?.message);if(!data||!m||!id(m.id))return;
    const outer=data.channel_id,inner=m.channel_id,channel=outer??inner;
    if(channel!==this.state.channelId||(outer!=null&&inner!=null&&outer!==inner))return;
    if(this.deleted.has(m.id))return;
    const previous=this.state.messages.find(p=>p.id===m.id);
    if(packet.evt==='MESSAGE_CREATE'&&previous)return;
    const remove=packet.evt==='MESSAGE_DELETE'||m.blocked===true;
    const next=remove?null:normalize(m,this.state.channelId,previous);if(!remove&&(!next||Date.parse(next.timestamp)<this.sinceUtcMs))return;
    this.touched.add(m.id);if(this.touched.size>1000)this.touched.delete(this.touched.values().next().value!);
    if(remove){this.deleted.add(m.id);if(this.deleted.size>1000)this.deleted.delete(this.deleted.values().next().value!);if(previous){this.state.messages=this.state.messages.filter(p=>p.id!==m.id);this.publish();}return;}
    if(previous&&JSON.stringify(next)===JSON.stringify(previous))return;
    this.replace([...this.state.messages.filter(p=>p.id!==m.id),next!]);this.publish();
  }
}
