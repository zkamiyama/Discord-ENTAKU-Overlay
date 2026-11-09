import { DIRECTOR } from './defaults.ts';
import type { SpeakingState } from '../contracts/domain.ts';
export interface SpeechInterval { start: number; end: number }
type Segment = SpeechInterval;
interface Episode { userId: string; start: number; activeMs: number; order: number }
interface Track {
  state: SpeakingState; startedAt: number; stoppedAt: number;
  episodeStart: number; accumulated: number; order: number; segments: Segment[];
}
export interface SpeechStats {
  userId: string; state: SpeakingState; activeMs: number; ratio: number;
  qualified: boolean; recentMs: number; windowMs: number; stoppedForMs: number; episodeStart: number;
}
export class SpeakerTracker {
  private tracks = new Map<string, Track>();
  private history: Episode[] = [];
  private order = 0;
  private lastMs = 0;
  private check(now: number): void {
    if (!Number.isFinite(now) || now < this.lastMs) throw new Error('NON_MONOTONIC_TIME');
    this.lastMs = now;
  }
  update(userId: string, state: SpeakingState, now: number): void {
    this.check(now);
    if (state === 'unknown') { this.tracks.delete(userId); this.history = this.history.filter(e => e.userId !== userId); return; }
    let t = this.tracks.get(userId);
    if (!t) {
      t = { state: 'unknown', startedAt: now, stoppedAt: -Infinity, episodeStart: now, accumulated: 0, order: this.order++, segments: [] };
      this.tracks.set(userId, t);
    }
    if (t.state === state) return;
    if (state === 'active') {
      if (now - t.stoppedAt > DIRECTOR.gapToleranceMs) {
        if (t.accumulated >= 250) this.history.push({ userId, start: t.episodeStart, activeMs: t.accumulated, order: t.order });
        t.episodeStart = now; t.accumulated = 0; t.order = this.order++;
      }
      t.startedAt = now;
    } else {
      if (t.state === 'active') {
        t.accumulated += now - t.startedAt;
        t.segments.push({ start: t.startedAt, end: now });
      }
      t.stoppedAt = now;
    }
    t.state = state;
    this.prune(now);
  }
  stats(userId: string, now: number): SpeechStats {
    this.check(now);
    const t = this.tracks.get(userId);
    if (!t) return { userId, state: 'unknown', activeMs: 0, ratio: 0, qualified: false, recentMs: 0, windowMs: 0, stoppedForMs: Infinity, episodeStart: now };
    const activeMs = t.accumulated + (t.state === 'active' ? now - t.startedAt : 0);
    const duration = now - t.episodeStart;
    const ratio = duration > 0 ? activeMs / duration : 0;
    const recentMs = t.segments.reduce((sum, s) => sum + Math.max(0, Math.min(now, s.end) - Math.max(now - 3000, s.start)), 0)
      + (t.state === 'active' ? now - Math.max(now - 3000, t.startedAt) : 0);
    const windowStart=now-DIRECTOR.leadershipWindowMs;
    const windowMs=t.segments.reduce((sum,s)=>sum+Math.max(0,Math.min(now,s.end)-Math.max(windowStart,s.start)),0)
      +(t.state==='active'?now-Math.max(windowStart,t.startedAt):0);
    return { userId, state: t.state, activeMs, ratio, windowMs, qualified: t.state === 'active' && activeMs >= DIRECTOR.qualifyMs && ratio >= DIRECTOR.minSpeechRatio,
      recentMs, stoppedForMs: t.state === 'active' ? 0 : now - t.stoppedAt, episodeStart: t.episodeStart };
  }
  episodes(now: number, windowMs: number): Episode[] {
    this.check(now); this.prune(now);
    const current = [...this.tracks.entries()].map(([userId, t]) => ({ userId, start: t.episodeStart, activeMs: t.accumulated + (t.state === 'active' ? now - t.startedAt : 0), order: t.order }));
    return [...this.history, ...current].filter(e => e.start >= now - windowMs && e.activeMs >= 250).sort((a, b) => a.start - b.start || a.order - b.order);
  }
  /** Exact half-open speaking intervals; pauses never count as speech. */
  intervals(userId:string,now:number,windowMs=DIRECTOR.leadershipWindowMs):SpeechInterval[]{
    this.check(now);this.prune(now);
    const track=this.tracks.get(userId);if(!track)return [];
    const segments=[...track.segments,...(track.state==='active'?[{start:track.startedAt,end:now}]:[])];
    return segments.map(s=>({start:Math.max(now-windowMs,s.start),end:Math.min(now,s.end)})).filter(s=>s.end>s.start);
  }
  clear(): void { this.tracks.clear(); this.history = []; }
  private prune(now: number): void {
    this.history = this.history.filter(e => e.start >= now - 10000).slice(-1024);
    for (const t of this.tracks.values()) t.segments = t.segments.filter(s => s.end >= now - 10000).slice(-512);
  }
}
