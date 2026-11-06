import type { ProviderEvent, ConnectionStatus } from '../contracts/domain.ts';
import type { AuthProvider } from './auth-provider.ts';
import { discover } from './discovery.ts';
import { DiscordError,errorCode } from './errors.ts';
import { id,normalizeParticipant,normalizeSnapshot,object } from './normalize.ts';
import type { RpcClient } from './rpc-client.ts';

type Emit=(event:ProviderEvent)=>void;
type Packet=Record<string,unknown>;
const CHANNEL_EVENTS=['VOICE_STATE_CREATE','VOICE_STATE_UPDATE','VOICE_STATE_DELETE','SPEAKING_START','SPEAKING_STOP'];
export class IpcVoiceProvider {
  private running=false;
  private task:Promise<void>|null=null;
  private client:RpcClient|null=null;
  private generation=0;
  private wake: (()=>void)|null=null;
  constructor(private auth:AuthProvider,private emit:Emit,private now=()=>performance.now(),private paths?:string[]) {}
  start():void {
    if(this.running)return;
    this.running=true;
    this.task=this.run().finally(()=>{this.running=false;});
  }
  async stop():Promise<void> { this.running=false;this.wake?.();this.client?.close();await this.task;this.auth.clear(); }
  private status(status:ConnectionStatus,error?:string):void {this.emit({type:'connection',status,errorCode:error,sourceGeneration:this.generation,receivedAtMs:this.now()});}
  private async run():Promise<void> {
    let failures=0,interactive=true;
    while(this.running) {
      this.generation++;this.status('discovering');
      try {
        const found=await discover(this.auth.clientId,{},this.paths);
        this.client=found.client;
        if(!this.running){this.client.close();break;}
        this.status('authorizing');
        const allowPrompt=interactive;interactive=false;
        await this.auth.authenticate(this.client,allowPrompt);
        await this.session(this.client,()=>{failures=0;});
      } catch(error) {
        if(!this.running)break;
        const code=errorCode(error);
        if(code.startsWith('AUTH_')||code==='COMPAT_CONSENT_REQUIRED') {this.status('auth-required',code);break;}
        this.status('degraded',code);
        failures++;
      } finally {this.client?.close();this.client=null;}
      if(this.running) {
        const delay=Math.min(15000,Math.max(2000,1000*2**Math.min(failures,4)*(0.8+Math.random()*0.4)));
        await new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.wake=null;resolve();},delay);this.wake=()=>{clearTimeout(timer);this.wake=null;resolve();};});
      }
    }
  }
  private async session(client:RpcClient,onReady:()=>void):Promise<void> {
    let channelId:string|null=null,syncing=true,queue:Packet[]=[],refreshing=false;
    let timer:ReturnType<typeof setInterval>|undefined,burst:ReturnType<typeof setTimeout>|undefined;
    const send=(event:Omit<Extract<ProviderEvent,{type:'snapshot'}>,'sourceGeneration'|'receivedAtMs'>|Omit<Extract<ProviderEvent,{type:'participant-upsert'}>,'sourceGeneration'|'receivedAtMs'>|Omit<Extract<ProviderEvent,{type:'participant-left'}>,'sourceGeneration'|'receivedAtMs'>|Omit<Extract<ProviderEvent,{type:'speaking'}>,'sourceGeneration'|'receivedAtMs'>):void=>{
      this.emit({...event,sourceGeneration:this.generation,receivedAtMs:this.now()} as ProviderEvent);
    };
    const refresh=async():Promise<void>=>{
      if(refreshing||!channelId||!this.running)return;refreshing=true;
      try {const snapshot=normalizeSnapshot(await client.request('GET_CHANNEL',{channel_id:channelId}));if(snapshot.channel?.channelId!==channelId)throw new DiscordError('SNAPSHOT_INCONSISTENT');send({type:'snapshot',...snapshot});}
      catch(error){client.close(error instanceof DiscordError?error:new DiscordError('SNAPSHOT_INCONSISTENT'));}
      finally{refreshing=false;}
    };
    const handle=(packet:Packet):void=>{
      const data=object(packet.data??{}),event=packet.evt;
      if(event==='VOICE_CHANNEL_SELECT') {
        const selected=data.channel_id===null?null:id(data.channel_id);
        if(selected!==channelId)client.close(new DiscordError('SOURCE_CHANGED'));
        return;
      }
      if(!channelId)return;
      if(typeof data.channel_id==='string'&&data.channel_id!==channelId)return;
      if(event==='SPEAKING_START'||event==='SPEAKING_STOP')send({type:'speaking',userId:id(data.user_id),state:event==='SPEAKING_START'?'active':'inactive'});
      else if(event==='VOICE_STATE_DELETE')send({type:'participant-left',userId:id(object(data.user).id)});
      else if(event==='VOICE_STATE_CREATE'||event==='VOICE_STATE_UPDATE')send({type:'participant-upsert',participant:normalizeParticipant(data,channelId)});
      if(typeof event==='string'&&event.startsWith('VOICE_STATE_')) {clearTimeout(burst);burst=setTimeout(()=>{void refresh();},1000);}
    };
    const off=client.onEvent(packet=>{if(syncing){if(queue.length>=4096)throw new DiscordError('SYNC_BUFFER_OVERFLOW');queue.push(packet);}else handle(packet);});
    try {
      this.status('subscribing');
      await client.request('SUBSCRIBE',{},'VOICE_CHANNEL_SELECT');
      let snapshot=normalizeSnapshot(await client.request('GET_SELECTED_VOICE_CHANNEL'));
      channelId=snapshot.channel?.channelId??null;
      if(snapshot.channel?.kind==='guild-voice') {
        for(const event of CHANNEL_EVENTS)await client.request('SUBSCRIBE',{channel_id:channelId},event);
        this.status('syncing');snapshot=normalizeSnapshot(await client.request('GET_CHANNEL',{channel_id:channelId}));
        if(snapshot.channel?.channelId!==channelId)throw new DiscordError('SOURCE_CHANGED');
      }
      send({type:'snapshot',...snapshot});
      syncing=false;for(const packet of queue)handle(packet);queue=[];
      if(client.isClosed)throw await client.whenClosed;
      onReady();
      this.status(snapshot.channel?.kind==='unsupported'?'degraded':'ready',snapshot.channel?.kind==='unsupported'?'UNSUPPORTED_CHANNEL':undefined);
      if(snapshot.channel?.kind==='guild-voice') {
        await refresh(); // Reconcile membership after the subscription/snapshot race.
        timer=setInterval(()=>{void refresh();},15000);
      }
      const reason=await client.whenClosed;
      if(this.running)throw reason;
    } finally {off();clearInterval(timer);clearTimeout(burst);}
  }
}
