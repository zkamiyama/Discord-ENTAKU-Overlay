import type { StudioBundle } from '../../studio/store.ts';
import type { StoredImage } from '../../assets/store.ts';
import type { AppSnapshot } from '../../contracts/domain.ts';
export class StudioClient {
  state: AppSnapshot | null = null;
  connected = false;
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
  connect(): void {
    clearTimeout(this.retry);
    this.onConnection('接続中');
    const socket = new WebSocket(`ws://${location.host}/ws`); this.socket = socket;
    socket.onmessage = event => {
      this.lastMessage=performance.now();
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'hello') {
          this.connected = true; this.bestRtt = Infinity;
          this.onConnection('接続済み'); this.ping();
          clearInterval(this.watchdog);this.watchdog=setInterval(()=>{if(performance.now()-this.lastMessage>10000){this.connected=false;socket.close(4000,'STALE');}},1000);
          clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.ping(), 5000);
        } else if (message.type === 'snapshot' && message.state?.protocolVersion === 1) {
          const state = message.state as AppSnapshot;
          if (state.serverEpoch !== this.epoch) { this.epoch = state.serverEpoch; this.bestRtt = Infinity; }
          if (this.bestRtt === Infinity) this.offset = state.serverNowMs - performance.now();
          this.state = state; this.stateReceivedAt=performance.now(); this.onState(state);
        } else if (message.type === 'pong') {
          const rtt = performance.now() - message.clientTime;
          if (rtt >= 0 && rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = message.serverTime - (performance.now() + message.clientTime) / 2; }
        }
      } catch { this.onConnection('状態の受信に失敗しました'); }
    };
    socket.onclose = event => {
      this.connected = false; clearInterval(this.pingTimer); clearInterval(this.watchdog); this.onConnection(event.code === 1008 ? '接続設定を確認してください' : '再接続待ち');
      if (event.code !== 1008) this.retry = setTimeout(() => this.connect(), 2000);
    };
  }
  now(): number { return this.state?.source==='replay'?this.state.serverNowMs+(performance.now()-this.stateReceivedAt)*(this.state.clockRate??1):performance.now()+this.offset; }
  private ping(): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping', clientTime: performance.now() })); }
  async command(command: Record<string,unknown>, expectedRevision = this.state?.revision): Promise<void> {
    if (!this.state) throw new Error('サーバーとの接続を確認してください');
    const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...command, requestId: crypto.randomUUID(), expectedRevision }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'COMMAND_FAILED');
  }
  reportRender(status:string,frameMs:number,drawCalls:number,triangles:number):void{
    if(this.connected&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:'render-status',status,frameMs,drawCalls,triangles}));
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
