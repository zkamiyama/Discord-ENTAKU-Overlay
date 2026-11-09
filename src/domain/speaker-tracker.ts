import {DEFAULT_DIRECTION,directionTiming,type DirectionSettings} from '../studio/direction.ts';
import { DIRECTOR } from './defaults.ts';
import type { SpeakingState } from '../contracts/domain.ts';
export interface SpeechInterval { start: number; end: number }
type Segment = SpeechInterval;
interface Episode { userId: string; start: number; activeMs: number; order: number }
interface Track {
  state: SpeakingState; startedAt: number; stoppedAt: number;
  episodeStart: number; accumulated: number; order: number; segments: Segment[];
  turnStart: number; turnSpeechMs: number; turnQualified: boolean;
}
export interface SpeechStats {
  userId: string; state: SpeakingState; activeMs: number; ratio: number;
  qualified: boolean; recentMs: number; windowMs: number; stoppedForMs: number; episodeStart: number;
}
/** Presentation-only hangover. Raw stats/intervals and the speaking glow stay unchanged. */
export interface ConversationStats extends SpeechStats {rawState:SpeakingState;endPendingUntilMs?:number}
export class SpeakerTracker {
  clone(): SpeakerTracker {return Object.assign(new SpeakerTracker(), structuredClone(this));}
  private timing=directionTiming();
  constructor(settings:DirectionSettings=DEFAULT_DIRECTION){this.configure(settings);}
  configure(settings:DirectionSettings):void{this.timing=directionTiming(settings);}
  get windowMs():number{return this.timing.leadershipWindowMs;}
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
      t = { state: 'unknown', startedAt: now, stoppedAt: -Infinity, episodeStart: now, accumulated: 0, order: this.order++, segments: [], turnStart: now, turnSpeechMs: 0, turnQualified: false };
      this.tracks.set(userId, t);
    }
    if (t.state === state) return;
    if (state === 'active') {
      if(now-t.stoppedAt>=this.timing.endConfirmMs){t.turnStart=now;t.turnSpeechMs=0;t.turnQualified=false;}
      if (now - t.stoppedAt > DIRECTOR.gapToleranceMs) {
        if (t.accumulated >= 250) this.history.push({ userId, start: t.episodeStart, activeMs: t.accumulated, order: t.order });
        t.episodeStart = now; t.accumulated = 0; t.order = this.order++;
      }
      t.startedAt = now;
    } else {
      if (t.state === 'active') {
        const speech=t.accumulated+now-t.startedAt,duration=now-t.episodeStart;
        t.turnQualified ||= speech>=this.timing.qualifyMs&&duration>0&&speech/duration>=DIRECTOR.minSpeechRatio;
        t.turnSpeechMs+=now-t.startedAt;
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
    const windowStart=now-this.timing.leadershipWindowMs;
    const windowMs=t.segments.reduce((sum,s)=>sum+Math.max(0,Math.min(now,s.end)-Math.max(windowStart,s.start)),0)
      +(t.state==='active'?now-Math.max(windowStart,t.startedAt):0);
    return { userId, state: t.state, activeMs, ratio, windowMs, qualified: t.state === 'active' && activeMs >= this.timing.qualifyMs && ratio >= DIRECTOR.minSpeechRatio,
      recentMs, stoppedForMs: t.state === 'active' ? 0 : now - t.stoppedAt, episodeStart: t.episodeStart };
  }
  /** Keep a qualified turn across hesitations, without inventing active audio.
   * stoppedForMs here starts at confirmed END, not the raw Discord STOP. */
  conversationStats(userId:string,now:number):ConversationStats {
    const raw=this.stats(userId,now),t=this.tracks.get(userId);
    if(!t)return {...raw,rawState:raw.state};
    const hasSpeech=t.turnSpeechMs>0||raw.state==='active';
    const pending=hasSpeech&&raw.state==='inactive'&&raw.stoppedForMs<this.timing.endConfirmMs;
    const activeMs=t.turnSpeechMs+(raw.state==='active'?now-t.startedAt:0);
    return {...raw,rawState:raw.state,state:pending?'active':raw.state,activeMs,episodeStart:t.turnStart,
      qualified:(raw.state==='active'||pending)&&(t.turnQualified||raw.qualified),
      stoppedForMs:raw.state==='inactive'&&hasSpeech?Math.max(0,raw.stoppedForMs-this.timing.endConfirmMs):raw.stoppedForMs,
      ...(pending?{endPendingUntilMs:t.stoppedAt+this.timing.endConfirmMs}:{})};
  }
  episodes(now: number, windowMs: number): Episode[] {
    this.check(now); this.prune(now);
    const current = [...this.tracks.entries()].map(([userId, t]) => ({ userId, start: t.episodeStart, activeMs: t.accumulated + (t.state === 'active' ? now - t.startedAt : 0), order: t.order }));
    return [...this.history, ...current].filter(e => e.start >= now - windowMs && e.activeMs >= 250).sort((a, b) => a.start - b.start || a.order - b.order);
  }
  /** Exact half-open speaking intervals; pauses never count as speech. */
  intervals(userId:string,now:number,windowMs=this.timing.leadershipWindowMs):SpeechInterval[]{
    this.check(now);this.prune(now);
    const track=this.tracks.get(userId);if(!track)return [];
    const segments=[...track.segments,...(track.state==='active'?[{start:track.startedAt,end:now}]:[])];
    return segments.map(s=>({start:Math.max(now-windowMs,s.start),end:Math.min(now,s.end)})).filter(s=>s.end>s.start);
  }
  clear(): void { this.tracks.clear(); this.history = []; }
  private prune(now: number): void {
    this.history = this.history.filter(e => e.start >= now - 10000).slice(-1024);
    for (const t of this.tracks.values()) t.segments = t.segments.filter(s => s.end >= now - 30000).slice(-512);
  }
}
