import type { Participant, ProviderEvent, SeatSession } from '../contracts/domain.ts';
import { AppEngine } from '../domain/engine.ts';
import { DIRECTOR, TABLE } from '../domain/defaults.ts';
import { validateSession } from '../domain/seat-allocator.ts';
const ID = /^\d{1,20}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REPLAY_RECORD');
  return value as Record<string, unknown>;
}
function participant(value: unknown): Participant {
  const p = record(value), v = record(p.voice);
  if (typeof p.userId !== 'string' || !ID.test(p.userId) || typeof p.channelId !== 'string' || !ID.test(p.channelId)) throw new Error('INVALID_REPLAY_ID');
  for (const key of ['username','displayName']) if (typeof p[key] !== 'string' || (p[key] as string).length > 512) throw new Error('INVALID_REPLAY_NAME');
  if (!['present','absent','stale'].includes(String(p.presence)) || !['active','inactive','unknown'].includes(String(p.speaking))) throw new Error('INVALID_REPLAY_STATE');
  for (const key of ['selfMute','selfDeaf','serverMute','serverDeaf']) if (typeof v[key] !== 'boolean') throw new Error('INVALID_REPLAY_VOICE');
  // Replay files cannot instruct the process to download arbitrary URLs.
  return { userId: p.userId, channelId: p.channelId, username: p.username as string, displayName: p.displayName as string,
    presence: p.presence as Participant['presence'], speaking: p.speaking as Participant['speaking'], voice: v as unknown as Participant['voice'] };
}
export function validateProviderEvent(input: unknown): ProviderEvent {
  const e = record(input);
  if (!Number.isSafeInteger(e.sourceGeneration) || (e.sourceGeneration as number) < 0 || typeof e.receivedAtMs !== 'number' || !Number.isFinite(e.receivedAtMs) || e.receivedAtMs < 0) throw new Error('INVALID_REPLAY_TIME');
  const meta = { sourceGeneration: e.sourceGeneration as number, receivedAtMs: e.receivedAtMs };
  if (e.type === 'connection') {
    if (!['disconnected','discovering','authorizing','subscribing','syncing','ready','degraded','auth-required'].includes(String(e.status))) throw new Error('INVALID_REPLAY_CONNECTION');
    return { ...meta, type: 'connection', status: e.status as Extract<ProviderEvent,{type:'connection'}>['status'] };
  }
  if (e.type === 'snapshot') {
    const channel = e.channel === null ? null : record(e.channel);
    if (channel && (typeof channel.channelId !== 'string' || !ID.test(channel.channelId) || typeof channel.name !== 'string' || channel.name.length > 512 || !['guild-voice','unsupported'].includes(String(channel.kind)))) throw new Error('INVALID_REPLAY_CHANNEL');
    if (!Array.isArray(e.participants) || e.participants.length > 1024) throw new Error('INVALID_REPLAY_PARTICIPANTS');
    const participants = e.participants.map(participant);
    if (new Set(participants.map(p => p.userId)).size !== participants.length || participants.some(p => p.channelId !== channel?.channelId)) throw new Error('INVALID_REPLAY_PARTICIPANTS');
    return { ...meta, type: 'snapshot', channel: channel as Extract<ProviderEvent,{type:'snapshot'}>['channel'], participants };
  }
  if (e.type === 'participant-upsert') return { ...meta, type: e.type, participant: participant(e.participant) };
  if (typeof e.userId !== 'string' || !ID.test(e.userId)) throw new Error('INVALID_REPLAY_ID');
  if (e.type === 'participant-left') return { ...meta, type: e.type, userId: e.userId };
  if (e.type === 'speaking' && (e.state === 'active' || e.state === 'inactive')) return { ...meta, type: e.type, userId: e.userId, state: e.state };
  throw new Error('INVALID_REPLAY_EVENT');
}
export interface Replay { durationMs: number; session?: SeatSession; events: Array<{ atMs: number; event: ProviderEvent }> }
export function parseReplay(text: string): Replay {
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('REPLAY_TOO_LARGE');
  const rows = text.split(/\r?\n/).filter(line => line.trim()).map(line => record(JSON.parse(line)));
  const header = rows.shift();
  if (!header || header.kind !== 'header' || header.schemaVersion !== 1 || header.originMs !== 0 || typeof header.durationMs !== 'number' || !Number.isFinite(header.durationMs) || header.durationMs <= 0 || header.durationMs > 86400000) throw new Error('INVALID_REPLAY_HEADER');
  const durationMs = header.durationMs;
  if (rows.length > 100000) throw new Error('TOO_MANY_REPLAY_EVENTS');
  // The current milestone supports the default scene/config only; never silently ignore changes.
  if (header.project) {
    const config = record(record(header.project).director);
    for (const [key, value] of Object.entries(DIRECTOR)) if (config[key] !== value) throw new Error('REPLAY_CONFIG_UNSUPPORTED');
  }
  if (header.scene) {
    const scene = record(header.scene);
    const table = record(scene.table), anchor = record(scene.tableAnchor);
    for (const [key,value] of Object.entries(TABLE)) if (table[key] !== value) throw new Error('REPLAY_SCENE_UNSUPPORTED');
    if (JSON.stringify(anchor.position) !== '[0,0,0]' || JSON.stringify(anchor.rotationDeg) !== '[0,0,0]' || JSON.stringify(anchor.scale) !== '[1,1,1]') throw new Error('REPLAY_SCENE_UNSUPPORTED');
    if (Array.isArray(scene.nodes) && scene.nodes.some(n => record(n).kind !== 'light')) throw new Error('REPLAY_SCENE_UNSUPPORTED');
    if (JSON.stringify(scene.assets ?? []) !== '[]' || JSON.stringify(scene.cameraBlockers ?? []) !== '[]') throw new Error('REPLAY_SCENE_UNSUPPORTED');
  }
  let last = 0;
  const events = rows.map(row => {
    if (row.kind !== 'provider' || typeof row.atMs !== 'number' || !Number.isFinite(row.atMs) || row.atMs < last || row.atMs > durationMs) throw new Error('INVALID_REPLAY_ORDER');
    const event = validateProviderEvent(row.event);
    if (event.receivedAtMs !== row.atMs) throw new Error('INVALID_REPLAY_TIME');
    last = row.atMs;
    return { atMs: row.atMs, event };
  });
  return { durationMs, ...(header.session ? { session: validateSession(header.session) } : {}), events };
}
/** Virtual 20Hz clock: the same file produces the same decisions regardless of wall-clock speed. */
export class ReplayPlayer {
  private index = 0;
  private nextTick = 0;
  private time = 0;
  constructor(readonly replay: Replay, readonly engine: AppEngine) {}
  advanceTo(target: number): void {
    if (!Number.isFinite(target) || target < this.time) throw new Error('REPLAY_CLOCK_REGRESSION');
    target = Math.min(target, this.replay.durationMs);
    for (;;) {
      const eventAt = this.replay.events[this.index]?.atMs ?? Infinity;
      const next = Math.min(this.nextTick, eventAt);
      if (next > target) break;
      while (this.replay.events[this.index]?.atMs === next) this.engine.apply(this.replay.events[this.index++]!.event, next);
      if (this.nextTick === next) { this.engine.tick(next); this.nextTick += 50; }
    }
    this.time = target;
  }
  async seekTo(target:number):Promise<void>{
    if(!Number.isFinite(target)||target<0||target>this.replay.durationMs)throw new Error('INVALID_REPLAY_TIME');
    this.engine.rewindReplay(this.replay.session?[this.replay.session]:[]);
    this.index=0;this.nextTick=0;this.time=0;this.advanceTo(0);
    while(this.time<target){this.advanceTo(Math.min(target,this.time+5000));await new Promise<void>(resolve=>setTimeout(resolve,0));}
  }
  get elapsedMs(): number { return this.time; }
  get done(): boolean { return this.time >= this.replay.durationMs; }
}
