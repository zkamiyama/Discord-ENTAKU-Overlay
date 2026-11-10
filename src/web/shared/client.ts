import type {Command} from '../../contracts/commands.ts';
import type {VcChatState} from '../../contracts/vc-chat.ts';
import type { StudioBundle } from '../../studio/store.ts';
import type { StoredImage } from '../../assets/store.ts';
import type {StoredGaussianAsset} from '../../assets/gaussian-store.ts';
import type {GaussianAvatarManifest} from '../../assets/gaussian-profile.ts';
import type { AppSnapshot } from '../../contracts/domain.ts';
export class StudioClient {
  state: AppSnapshot | null = null;
  connected = false;
  chat:VcChatState|null=null;
  onChat:(state:VcChatState|null)=>void=()=>{};
  private wantsChat=false;
  watchChat():void{this.wantsChat=true;if(this.connected)this.socket?.send(JSON.stringify({type:'vc-chat-subscribe'}));}
  private socket: WebSocket | null = null;
  private offset = 0;
  private bestRtt = Infinity;
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
  ) {}
  private clearTimers(): void {
    clearTimeout(this.retry); clearInterval(this.pingTimer); clearInterval(this.watchdog);
    this.retry = this.pingTimer = this.watchdog = undefined;
  }
  disconnect(): void {
    this.clearTimers();
    const previous = this.socket; this.socket = null;
    this.connected = false; this.chat = null; this.onChat(null);
    previous?.close(1000, 'CLIENT_STOPPED');
  }
  connect(): void {
    // Detach the old owner before closing: even synchronous/late close events
    // must not reset a replacement connection or schedule another reconnect.
    this.disconnect();
    this.onConnection('接続中');
    const socket = this.createSocket(this.socketUrl()); this.socket = socket;
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.lastMessage=performance.now();
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'hello') {
          this.connected = true; this.bestRtt = Infinity;
          this.onConnection('接続済み'); this.ping();if(this.wantsChat)this.watchChat();
          clearInterval(this.watchdog);this.watchdog=setInterval(()=>{if(performance.now()-this.lastMessage>10000){this.connected=false;socket.close(4000,'STALE');}},1000);
          clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.ping(), 5000);
        } else if (message.type === 'snapshot' && message.state?.protocolVersion === 1) {
          const state = message.state as AppSnapshot;
          if (state.serverEpoch !== this.epoch) { this.epoch = state.serverEpoch; this.bestRtt = Infinity; }
          if (this.bestRtt === Infinity) this.offset = state.serverNowMs - performance.now();
          this.state = state; this.stateReceivedAt=performance.now(); this.onState(state);
        } else if(message.type==='vc-chat'&&this.wantsChat&&message.state){
          this.chat=message.state as VcChatState;this.onChat(this.chat);
        } else if (message.type === 'pong') {
          const rtt = performance.now() - message.clientTime;
          if (rtt >= 0 && rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = message.serverTime - (performance.now() + message.clientTime) / 2; }
        }
      } catch { this.onConnection('状態の受信に失敗しました'); }
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null; this.clearTimers();
      this.connected = false; this.chat=null;this.onChat(null);clearInterval(this.pingTimer); clearInterval(this.watchdog); this.onConnection(event.code === 1008 ? '接続設定を確認してください' : '再接続待ち');
      if (event.code !== 1008) this.retry = setTimeout(() => this.connect(), this.retryMs);
    };
  }
  now(): number { return this.state?.source==='replay'?this.state.serverNowMs+(performance.now()-this.stateReceivedAt)*(this.state.clockRate??1):performance.now()+this.offset; }
  private ping(): void { if (this.socket?.readyState === 1 /* WebSocket.OPEN */) this.socket.send(JSON.stringify({ type: 'ping', clientTime: performance.now() })); }
  resync():void {if(this.socket?.readyState===1)this.socket.send(JSON.stringify({type:'resync'}));}
  async command(command: Command, expectedRevision = this.state?.revision): Promise<void> {
    await this.requestCommand(command,expectedRevision);
  }
  async requestCommand(command: Command, expectedRevision = this.state?.revision): Promise<Record<string,unknown>> {
    if (!this.state) throw new Error('サーバーとの接続を確認してください');
    const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...command, requestId: crypto.randomUUID(), expectedRevision }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'COMMAND_FAILED');
    return result;
  }
  reportRender(status:string,frameMs:number,drawCalls:number,triangles:number,exposure?:{exposure:number;exposureStatus:string;authoredLights:number;fallbackLights:boolean;qualityStatus?:string;shadowLights?:number;msaaSamples?:number}):void{
    if(this.connected&&this.socket?.readyState===1 /* WebSocket.OPEN */)this.socket.send(JSON.stringify({type:'render-status',status,frameMs,drawCalls,triangles,...exposure}));
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
  async customImage(assetId:string):Promise<ImageBitmap>{
    const response=await fetch(`/api/assets/${encodeURIComponent(assetId)}`);
    if(!response.ok)throw new Error('ASSET_NOT_FOUND');return createImageBitmap(await response.blob());
  }
  async avatar(userId: string): Promise<ImageBitmap> {
    const response = await fetch(`/api/avatars/${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error('AVATAR_UNAVAILABLE');
    return createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
  }
}
