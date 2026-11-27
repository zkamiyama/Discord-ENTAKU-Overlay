import type {FramePerformance} from '../../contracts/diagnostics.ts';
import {StateReceiver} from '../../contracts/state-stream.ts';
import type {Command} from '../../contracts/commands.ts';
import type {VcChatState} from '../../contracts/vc-chat.ts';
import type { StudioBundle } from '../../studio/store.ts';
import type { StoredImage } from '../../assets/store.ts';
import type {StoredGaussianAsset} from '../../assets/gaussian-store.ts';
import type {GaussianAvatarManifest} from '../../assets/gaussian-profile.ts';
import type { AppSnapshot } from '../../contracts/domain.ts';
const commandConnectionChanged=()=>new Error('接続が切り替わりました。操作結果は再同期後の状態で確認してください');
export class StudioClient {
  state: AppSnapshot | null = null;
  connected = false;
  chat:VcChatState|null=null;
  onChat:(state:VcChatState|null)=>void=()=>{};
  private wantsChat=false;
  watchChat():void{this.wantsChat=true;if(this.greeted)this.send({type:'vc-chat-subscribe'});}
  private socket: WebSocket | null = null;
  private lifetime:AbortController|null=null;
  private greeted=false;
  private readonly stream=new StateReceiver();
  private awaitingFull=false;
  private offset = 0;
  private bestRtt = Infinity;
  private pingSentAt:number|undefined;
  private lastMessage=0;
  private stateReceivedAt=0;
  private watchdog?:ReturnType<typeof setInterval>;
  private epoch = '';
  private retry?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  onState: (state: AppSnapshot) => void = () => {};
  onConnection: (status: string) => void = () => {};
  constructor(
    private readonly createSocket: (url: string) => WebSocket = url => new WebSocket(url),
    private readonly socketUrl: () => string = () => `ws://${location.host}/ws`,
    private readonly retryMs = 2000,
    private readonly staleMs = 10_000,
  ) {}
  private clearTimers(): void {
    clearTimeout(this.retry); clearInterval(this.pingTimer); clearInterval(this.watchdog);
    this.retry = this.pingTimer = this.watchdog = undefined;
  }
  private detach():WebSocket|null {
    const previous=this.socket;this.socket=null;
    this.clearTimers();this.stream.reset();this.awaitingFull=false;
    this.greeted=false;this.pingSentAt=undefined;
    this.lifetime?.abort(commandConnectionChanged());this.lifetime=null;
    this.connected=false;this.chat=null;
    if(previous)previous.onmessage=previous.onclose=previous.onerror=null;
    this.onChat(null);
    return previous;
  }
  disconnect(): void {
    const previous=this.detach();
    try{previous?.close(1000,'CLIENT_STOPPED');}catch{/* The detached connection no longer owns state. */}
  }
  private lost(socket:WebSocket,code:number,reason?:string):void {
    if(this.socket!==socket)return;
    this.detach();
    // Do not wait for a closing handshake from an unresponsive peer. The
    // detached socket's eventual events cannot affect its replacement.
    if(reason)try{socket.close(code,reason);}catch{/* Already closed. */}
    this.onConnection(code===1008?'接続設定を確認してください':'再接続待ち');
    if(code!==1008)this.retry=setTimeout(()=>this.connect(),this.retryMs);
  }
  private send(message:unknown):boolean {
    const socket=this.socket;
    if(socket?.readyState!==1)return false;
    try{socket.send(JSON.stringify(message));return true;}
    catch{this.lost(socket,4000,'SEND_FAILED');return false;}
  }
  connect(): void {
    // Detach the old owner before closing: even synchronous/late close events
    // must not reset a replacement connection or schedule another reconnect.
    this.disconnect();
    this.onConnection('接続中');
    let socket:WebSocket;
    try{socket=this.createSocket(this.socketUrl());}
    catch{this.onConnection('再接続待ち');this.retry=setTimeout(()=>this.connect(),this.retryMs);return;}
    this.socket=socket;this.lifetime=new AbortController();this.lastMessage=performance.now();
    // A peer that never sends hello is just as stale as an established peer
    // that stops sending messages. Start monitoring at socket creation.
    this.watchdog=setInterval(()=>{
      if(this.socket!==socket)return;
      if(performance.now()-this.lastMessage>=this.staleMs)this.lost(socket,4000,'STALE');
    },Math.min(1000,this.staleMs));
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      let message:Record<string,unknown>;
      try{
        const value:unknown=JSON.parse(String(event.data));
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_MESSAGE');
        message=value as Record<string,unknown>;
      }catch{if(this.greeted)this.resync();return;}
        if (message.type === 'hello') {
          if(this.greeted)return;
          this.greeted=true;this.bestRtt=Infinity;this.lastMessage=performance.now();
          this.onConnection('状態を同期中');this.ping();if(this.wantsChat)this.watchChat();
          if(this.socket!==socket)return;
          this.pingTimer=setInterval(()=>this.ping(),5000);
        } else if (!this.greeted)return;
        else if (message.type === 'snapshot'||message.type==='snapshot-delta') {
          if(this.awaitingFull&&message.type!=='snapshot')return;
          const state=this.stream.accept(message);
          if(!state){this.resync();return;}
          this.awaitingFull=false;this.lastMessage=performance.now();
          const recovered=!this.connected;this.connected=true;
          // Duplicate full frames are liveness evidence, not a new playback
          // clock origin or a reason to rebuild unchanged scene resources.
          if(state!==this.state){
            if(state.serverEpoch!==this.epoch){this.epoch=state.serverEpoch;this.bestRtt=Infinity;this.pingSentAt=undefined;}
            if(this.bestRtt===Infinity)this.offset=state.serverNowMs-this.lastMessage;
            this.state=state;this.stateReceivedAt=this.lastMessage;this.onState(state);
          }
          if(recovered&&this.socket===socket)this.onConnection('接続済み');
        } else if(message.type==='vc-chat'&&this.wantsChat&&message.state){
          this.chat=message.state as VcChatState;this.onChat(this.chat);
        } else if (message.type === 'pong') {
          if(message.clientTime!==this.pingSentAt||typeof message.clientTime!=='number'||typeof message.serverTime!=='number'||!Number.isFinite(message.serverTime))return;
          const time=performance.now(),rtt=time-message.clientTime;this.pingSentAt=undefined;
          if(rtt>=0&&rtt<this.bestRtt){this.bestRtt=rtt;this.offset=message.serverTime-(time+message.clientTime)/2;}
        }
    };
    socket.onclose=event=>this.lost(socket,event.code);
    socket.onerror=()=>this.lost(socket,4000,'CONNECTION_FAILED');
  }
  now(): number { return this.state?.source==='replay'?this.state.serverNowMs+(performance.now()-this.stateReceivedAt)*(this.state.clockRate??1):performance.now()+this.offset; }
  private ping():void {this.pingSentAt=performance.now();this.send({type:'ping',clientTime:this.pingSentAt});}
  resync():void {
    if(!this.greeted||this.awaitingFull)return;
    this.awaitingFull=true;this.connected=false;this.onConnection('再同期中');this.send({type:'resync'});
  }
  async command(command: Command, expectedRevision = this.state?.revision): Promise<void> {
    await this.requestCommand(command,expectedRevision);
  }
  async requestCommand(command: Command, expectedRevision = this.state?.revision): Promise<Record<string,unknown>> {
    if (!this.connected||!this.state||!this.stream.ready||!this.lifetime) throw new Error('サーバーとの接続を確認してください');
    const lifetime=this.lifetime;
    const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal:lifetime.signal,body: JSON.stringify({ ...command, requestId: crypto.randomUUID(), expectedRevision }) });
    const result = await response.json();
    // Aborting transport cannot undo an already committed server operation.
    // Never retry it automatically or treat a prior connection's reply as new.
    if(lifetime!==this.lifetime||lifetime.signal.aborted)throw commandConnectionChanged();
    if (!response.ok) throw new Error(result.error ?? 'COMMAND_FAILED');
    return result;
  }
  reportRender(status:string,frameMs:number,drawCalls:number,triangles:number,exposure?:{exposure:number;exposureStatus:string;authoredLights:number;fallbackLights:boolean;qualityStatus?:string;shadowLights?:number;msaaSamples?:number},metrics?:FramePerformance):void{
    if(this.greeted)this.send({type:'render-status',status,frameMs,drawCalls,triangles,...exposure,...metrics});
  }
  async localFetch(url:string,init:RequestInit={}):Promise<Response>{
    const response=await fetch(url,init);
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error??'REQUEST_FAILED');}
    return response;
  }
  async importStudio(files:readonly File[],entry?:string):Promise<StudioBundle>{
    const form=new FormData();
    if(entry)form.set('entry',entry);
    if(files.length===1&&/\.zip$/i.test(files[0]!.name))form.set('archive',files[0]!);
    else for(const file of files)form.append('file:'+(file.webkitRelativePath||file.name),file,file.name);
    return (await this.localFetch('/api/studio/import',{method:'POST',body:form})).json();
  }
  async importImage(file: Blob): Promise<StoredImage> {
    const response=await fetch('/api/assets',{method:'POST',headers:{'Content-Type':file.type},body:file});
    const value=await response.json();if(!response.ok)throw new Error(value.error??'ASSET_IMPORT_FAILED');return value as StoredImage;
  }
  async gaussianAssets():Promise<StoredGaussianAsset[]> {
    return (await this.localFetch('/api/gaussian-assets')).json();
  }
  async gaussianAsset(assetId:string):Promise<StoredGaussianAsset> {
    return (await this.localFetch(`/api/gaussian-assets/${encodeURIComponent(assetId)}`)).json();
  }
  async importGaussian(file:File,proxy?:File,preview?:File):Promise<StoredGaussianAsset> {
    const form=new FormData();
    form.set(/\.zip$/i.test(file.name)?'archive':'splat',file,file.name);
    if(proxy)form.set('proxy',proxy,proxy.name);
    if(preview)form.set('preview',preview,preview.name);
    return (await this.localFetch('/api/gaussian-assets/import',{method:'POST',body:form})).json();
  }
  async exportGaussian(assetId:string,manifest:GaussianAvatarManifest):Promise<Blob> {
    return (await this.localFetch(`/api/gaussian-assets/${encodeURIComponent(assetId)}/export`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manifest}),
    })).blob();
  }
  async customImage(assetId:string,signal?:AbortSignal):Promise<ImageBitmap>{
    const response=await fetch(`/api/assets/${encodeURIComponent(assetId)}`,{signal});
    if(!response.ok)throw new Error('ASSET_NOT_FOUND');
    return this.decodeImage(await response.blob(),signal);
  }
  async avatar(userId: string,signal?:AbortSignal): Promise<ImageBitmap> {
    const response = await fetch(`/api/avatars/${encodeURIComponent(userId)}`,{signal});
    if (!response.ok) throw new Error('AVATAR_UNAVAILABLE');
    return this.decodeImage(await response.blob(),signal,{imageOrientation:'flipY'});
  }
  private async decodeImage(blob:Blob,signal?:AbortSignal,options?:ImageBitmapOptions):Promise<ImageBitmap>{
    signal?.throwIfAborted();
    const bitmap=await createImageBitmap(blob,options);
    if(signal?.aborted){bitmap.close();signal.throwIfAborted();}
    return bitmap;
  }
}
