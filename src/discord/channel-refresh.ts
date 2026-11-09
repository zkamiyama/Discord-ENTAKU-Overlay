import {DiscordError} from './errors.ts';
import type {RpcClient} from './rpc-client.ts';

export interface ChannelRefreshOptions {
  intervalMs: number;
  retryMs: number;
  maxFailures: number;
}
const DEFAULTS: ChannelRefreshOptions = {intervalMs: 15000, retryMs: 750, maxFailures: 3};

/** A session owns one refresher. Only request timeouts on an open IPC connection
 * are retried; malformed snapshots, permission errors and transport loss are fatal. */
export class ChannelRefresh {
  private stopped = false;
  private busy = false;
  private failures = 0;
  private interval?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private options: ChannelRefreshOptions;

  constructor(
    private client: Pick<RpcClient, 'request' | 'isClosed'>,
    private channelId: string,
    private accept: (raw: unknown) => void,
    private fail: (error: DiscordError) => void,
    options: Partial<ChannelRefreshOptions> = {},
  ) {
    this.options = {...DEFAULTS, ...options};
    if (!Object.values(this.options).every(v => Number.isFinite(v) && v > 0)
      || !Number.isInteger(this.options.maxFailures)) throw new Error('INVALID_REFRESH_OPTIONS');
  }

  start(): void {
    if (!this.stopped && !this.interval) {
      this.interval = setInterval(() => {void this.refresh();}, this.options.intervalMs);
    }
  }

  async refresh(): Promise<void> {
    if (this.stopped || this.busy || this.client.isClosed) return;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.busy = true;
    try {
      const raw = await this.client.request('GET_CHANNEL', {channel_id: this.channelId});
      if (this.stopped || this.client.isClosed) return;
      this.accept(raw);
      this.failures = 0;
    } catch (error) {
      if (this.stopped) return;
      const reason = error instanceof DiscordError ? error : new DiscordError('SNAPSHOT_INCONSISTENT');
      if (!this.client.isClosed && reason.code === 'RPC_TIMEOUT' && ++this.failures < this.options.maxFailures) {
        this.retry = setTimeout(() => {void this.refresh();}, this.options.retryMs);
      } else {
        this.dispose();
        this.fail(reason);
      }
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.stopped = true;
    clearInterval(this.interval);
    clearTimeout(this.retry);
    this.interval = this.retry = undefined;
  }
}
