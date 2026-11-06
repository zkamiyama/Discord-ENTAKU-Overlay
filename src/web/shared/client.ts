import type { StudioBundle } from '../../studio/store.ts';
import type { StoredImage } from '../../assets/store.ts';
import type { AppSnapshot } from '../../contracts/domain.ts';
export class StudioClient {
  state: AppSnapshot | null = null;
  connected = false;
  role: 'read' | 'control' | null = null;
  overlayUrl: string | null = null;
  private socket: WebSocket | null = null;
  private key: string;
  private offset = 0;
  private bestRtt = Infinity;
  private lastMessage=0;
  private watchdog?:ReturnType<typeof setInterval>;
  private epoch = '';
  private retry?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  onState: (state: AppSnapshot) => void = () => {};
  onConnection: (status: string) => void = () => {};
  constructor() {
    const fragment = new URLSearchParams(location.hash.slice(1)).get('key');
    const storage = `entaku-key:${location.pathname}`;
    this.key = fragment ?? sessionStorage.getItem(storage) ?? '';
    if (fragment) { sessionStorage.setItem(storage, fragment); history.replaceState(null, '', location.pathname + location.search); }
  }
  connect(): void {
    if (!/^[0-9a-f]{64}$/.test(this.key)) { this.onConnection('認証キー付きURLを設定してください'); return; }
    clearTimeout(this.retry);
    this.onConnection('接続中');
    const socket = new WebSocket(`ws://${location.host}/ws`); this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', key: this.key }));
    socket.onmessage = event => {
      this.lastMessage=performance.now();
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'hello') {
          this.role = message.role; this.overlayUrl = message.overlayUrl ?? null;
          this.connected = true; this.bestRtt = Infinity;
          this.onConnection('接続済み'); this.ping();
          clearInterval(this.watchdog);this.watchdog=setInterval(()=>{if(performance.now()-this.lastMessage>10000){this.connected=false;socket.close(4000,'STALE');}},1000);
          clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.ping(), 5000);
        } else if (message.type === 'snapshot' && message.state?.protocolVersion === 1) {
          const state = message.state as AppSnapshot;
          if (state.serverEpoch !== this.epoch) { this.epoch = state.serverEpoch; this.bestRtt = Infinity; }
          if (this.bestRtt === Infinity) this.offset = state.serverNowMs - performance.now();
          this.state = state; this.onState(state);
        } else if (message.type === 'pong') {
          const rtt = performance.now() - message.clientTime;
          if (rtt >= 0 && rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = message.serverTime - (performance.now() + message.clientTime) / 2; }
        }
      } catch { this.onConnection('状態の受信に失敗しました'); }
    };
    socket.onclose = event => {
      this.connected = false; clearInterval(this.pingTimer); clearInterval(this.watchdog); this.onConnection(event.code === 1008 ? '認証または接続設定を確認してください' : '再接続待ち');
      if (event.code !== 1008) this.retry = setTimeout(() => this.connect(), 2000);
    };
  }
  now(): number { return performance.now() + this.offset; }
  private ping(): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping', clientTime: performance.now() })); }
  async command(command: Record<string,unknown>, expectedRevision = this.state?.revision): Promise<void> {
    if (this.role !== 'control' || !this.state) throw new Error('操作用キーで接続してください');
    const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ ...command, requestId: crypto.randomUUID(), expectedRevision }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'COMMAND_FAILED');
  }
  reportRender(status:string,frameMs:number,drawCalls:number,triangles:number):void{
    if(this.connected&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:'render-status',status,frameMs,drawCalls,triangles}));
  }
  async authorizedFetch(url:string,init:RequestInit={}):Promise<Response>{
    const response=await fetch(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${this.key}`}});
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error??'REQUEST_FAILED');}
    return response;
  }
  async importStudio(files:readonly File[],entry?:string):Promise<StudioBundle>{
    const form=new FormData();
    if(entry)form.set('entry',entry);
    if(files.length===1&&/\.zip$/i.test(files[0]!.name))form.set('archive',files[0]!);
    else for(const file of files)form.append('file:'+(file.webkitRelativePath||file.name),file,file.name);
    return (await this.authorizedFetch('/api/studio/import',{method:'POST',body:form})).json();
  }
  async importImage(file: Blob): Promise<StoredImage> {
    if(this.role!=='control')throw new Error('CONTROL_AUTH_REQUIRED');
    const response=await fetch('/api/assets',{method:'POST',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':file.type},body:file});
    const value=await response.json();if(!response.ok)throw new Error(value.error??'ASSET_IMPORT_FAILED');return value as StoredImage;
  }
  async customImage(assetId:string):Promise<ImageBitmap>{
    const response=await fetch(`/api/assets/${encodeURIComponent(assetId)}`,{headers:{Authorization:`Bearer ${this.key}`}});
    if(!response.ok)throw new Error('ASSET_NOT_FOUND');return createImageBitmap(await response.blob());
  }
  async avatar(userId: string): Promise<ImageBitmap> {
    const response = await fetch(`/api/avatars/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (!response.ok) throw new Error('AVATAR_UNAVAILABLE');
    return createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
  }
}
