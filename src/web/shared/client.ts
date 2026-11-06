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
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'hello') {
          this.role = message.role; this.overlayUrl = message.overlayUrl ?? null;
          this.connected = true; this.bestRtt = Infinity;
          this.onConnection('接続済み'); this.ping();
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
      this.connected = false; clearInterval(this.pingTimer); this.onConnection(event.code === 1008 ? '認証または接続設定を確認してください' : '再接続待ち');
      if (event.code !== 1008) this.retry = setTimeout(() => this.connect(), 2000);
    };
  }
  now(): number { return performance.now() + this.offset; }
  private ping(): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping', clientTime: performance.now() })); }
  async command(command: Record<string,unknown>): Promise<void> {
    if (this.role !== 'control' || !this.state) throw new Error('操作用キーで接続してください');
    const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ ...command, requestId: crypto.randomUUID(), expectedRevision: this.state.revision }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'COMMAND_FAILED');
  }
  async avatar(userId: string): Promise<ImageBitmap> {
    const response = await fetch(`/api/avatars/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (!response.ok) throw new Error('AVATAR_UNAVAILABLE');
    return createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
  }
}
