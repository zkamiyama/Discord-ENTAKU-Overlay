import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { APP } from '../domain/defaults.ts';
import { FrameDecoder, decodeObject, encodeFrame, encodeJson, Op } from './codec.ts';
import { DiscordError } from './errors.ts';

type Packet = Record<string, unknown>;
type Pending = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export interface RpcOptions {
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
  diagnostic?: (event: {event:string;command?:string;code?:string;rpcCode?:number;elapsedMs:number})=>void;
}

export class RpcClient {
  private decoder = new FrameDecoder();
  private readonly openedAt = performance.now();
  private diagnose(event:string,command?:string,error?:DiscordError):void {
    const entry={event,...(command&&/^[A-Z_]{1,64}$/.test(command)?{command}:{}),...(error?{code:error.code,...(Number.isSafeInteger(error.rpcCode)?{rpcCode:error.rpcCode}:{})}:{}),elapsedMs:Math.round(performance.now()-this.openedAt)};
    try{if(this.options.diagnostic)this.options.diagnostic(entry);else if(process.env.ENTAKU_RPC_TRACE==='1')console.log('[DISCORD-IPC] '+JSON.stringify(entry));}catch{/* Diagnostics never affect the connection. */}
  }
  private pending = new Map<string, Pending>();
  private events = new Map<(packet: Packet) => void, boolean>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private pingPayload?: Buffer;
  private misses = 0;
  private closed = false;
  private closeReason?: DiscordError;
  private resolveClosed!: (error: DiscordError) => void;
  readonly whenClosed: Promise<DiscordError>;

  private constructor(private socket: Socket, private options: RpcOptions) {
    this.whenClosed = new Promise(resolve => { this.resolveClosed = resolve; });
    socket.on('data', chunk => this.receive(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    socket.on('error', () => this.close(new DiscordError('IPC_DISCONNECTED')));
    socket.on('close', () => this.close(new DiscordError('IPC_DISCONNECTED')));
  }

  static async connect(path: string, clientId: string, options: RpcOptions = {}): Promise<RpcClient> {
    if (!/^\d{1,20}$/.test(clientId)) throw new DiscordError('INVALID_CLIENT_ID');
    const socket = createConnection(path);
    const client = new RpcClient(socket, options);
    // Register READY before writing the handshake, including on a very fast peer.
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        client.close(new DiscordError('RPC_HANDSHAKE_TIMEOUT'));
        reject(new DiscordError('RPC_HANDSHAKE_TIMEOUT'));
      }, options.handshakeTimeoutMs ?? 5000);
      const off = client.onEvent(packet => {
        if (packet.evt !== 'READY' || packet.cmd !== 'DISPATCH') return;
        clearTimeout(timer); off(); resolve();
      });
      void client.whenClosed.then(reason => { clearTimeout(timer); off(); reject(reason); });
    });
    // Attach a handler immediately so a connect failure cannot create an unhandled rejection.
    void ready.catch(() => {});
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          client.close(new DiscordError('IPC_CONNECT_TIMEOUT'));
          reject(new DiscordError('IPC_CONNECT_TIMEOUT'));
        }, options.connectTimeoutMs ?? 500);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        void client.whenClosed.then(reason => { clearTimeout(timer); reject(reason); });
      });
      client.write(encodeJson(Op.HANDSHAKE, { v: 1, client_id: clientId }));
      await ready;
      client.diagnose('ready');
      const interval = options.heartbeatMs ?? APP.heartbeatMs;
      if (interval > 0) {
        client.heartbeat = setInterval(() => client.checkHeartbeat(), interval);
        client.heartbeat.unref();
      }
      return client;
    } catch (error) {
      client.close(error instanceof DiscordError ? error : new DiscordError('IPC_DISCONNECTED'));
      throw error;
    }
  }

  get isClosed(): boolean { return this.closed; }

  onEvent(listener: (packet: Packet) => void, options: {fatal?: boolean} = {}): () => void {
    this.events.set(listener, options.fatal === true);
    return () => { this.events.delete(listener); };
  }

  request(command: string, args: Packet = {}, event?: string, timeoutMs = this.options.requestTimeoutMs ?? APP.rpcTimeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closeReason ?? new DiscordError('IPC_DISCONNECTED'));
    if (this.pending.size >= 128) return Promise.reject(new DiscordError('RPC_TOO_MANY_REQUESTS'));
    const nonce = randomUUID();
    this.diagnose('request',command);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        this.diagnose('request-failed',command,new DiscordError('RPC_TIMEOUT'));
        reject(new DiscordError('RPC_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(nonce, { command, resolve, reject, timer });
      try {
        this.write(encodeJson(Op.FRAME, { cmd: command, args, nonce, ...(event ? { evt: event } : {}) }));
      } catch (error) {
        clearTimeout(timer); this.pending.delete(nonce); reject(error);
      }
    });
  }

  close(reason = new DiscordError('IPC_DISCONNECTED')): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    this.diagnose('closed',undefined,reason);
    clearInterval(this.heartbeat);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(reason); }
    this.pending.clear();
    this.events.clear();
    this.socket.destroy();
    this.resolveClosed(reason);
  }

  private write(data: Buffer): void {
    if (this.closed) throw this.closeReason ?? new DiscordError('IPC_DISCONNECTED');
    if (this.socket.writableLength > APP.maxFrameBytes) {
      this.close(new DiscordError('RPC_BACKPRESSURE'));
      throw new DiscordError('RPC_BACKPRESSURE');
    }
    this.socket.write(data);
  }

  private checkHeartbeat(): void {
    if (this.closed) return;
    if (this.pingPayload && ++this.misses >= 2) { this.close(new DiscordError('RPC_HEARTBEAT_TIMEOUT')); return; }
    if (!this.pingPayload) this.pingPayload = Buffer.from(JSON.stringify(randomUUID()),'utf8');
    try { this.write(encodeFrame(Op.PING, this.pingPayload)); }
    catch { this.close(new DiscordError('RPC_BACKPRESSURE')); }
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    try {
      for (const frame of this.decoder.push(chunk)) {
        if (frame.opcode === Op.PING) { this.write(encodeFrame(Op.PONG, frame.payload)); continue; }
        if (frame.opcode === Op.PONG) {
          if (this.pingPayload?.equals(frame.payload)) { this.pingPayload = undefined; this.misses = 0; }
          continue;
        }
        if (frame.opcode === Op.CLOSE) {
          // Keep the numerical reason, never the peer's free-form text (which
          // could contain authorization data). IPC PING payloads are JSON too.
          let code:number|undefined;
          try{const data=decodeObject(frame.payload);if(Number.isSafeInteger(data.code))code=data.code as number;}catch{}
          this.close(new DiscordError('RPC_PEER_CLOSED',code));return;
        }
        if (frame.opcode !== Op.FRAME) throw new DiscordError('RPC_UNEXPECTED_OPCODE');
        const packet = decodeObject(frame.payload);
        if (typeof packet.cmd !== 'string') throw new DiscordError('RPC_MALFORMED_PACKET');
        const item = typeof packet.nonce === 'string' ? this.pending.get(packet.nonce) : undefined;
        if (item) {
          this.pending.delete(packet.nonce as string);
          clearTimeout(item.timer);
          if (packet.evt === 'ERROR') {
            const data = packet.data as { code?: unknown } | undefined;
            const error=new DiscordError('RPC_REJECTED', Number.isSafeInteger(data?.code)?data!.code as number:undefined);
            this.diagnose('request-failed',item.command,error);item.reject(error);
          } else if (packet.cmd !== item.command) {
            item.reject(new DiscordError('RPC_COMMAND_MISMATCH'));
          } else { this.diagnose('response',item.command);item.resolve(packet.data); }
        } else if (packet.cmd === 'DISPATCH' && typeof packet.evt === 'string') {
          for (const [listener, fatal] of [...this.events]) {
            if (this.closed) break;
            if (!this.events.has(listener)) continue;
            try { listener(packet); }
            catch (error) {
              if (fatal) throw error;
              // Isolate optional consumers. Never log event payloads or thrown text.
              this.events.delete(listener);
              this.diagnose('handler-failed', packet.evt, new DiscordError('RPC_OPTIONAL_HANDLER_FAILED'));
            }
          }
        }
      }
    } catch (error) {
      this.close(error instanceof DiscordError ? error : new DiscordError('RPC_HANDLER_FAILED'));
    }
  }
}
