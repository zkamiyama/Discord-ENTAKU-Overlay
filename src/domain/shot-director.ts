import type { Decision, DirectorMode, Shot } from '../contracts/domain.ts';
import { DIRECTOR as C } from './defaults.ts';
import { SpeakerTracker } from './speaker-tracker.ts';
export interface DirectorContext {
  presentIds: readonly string[];
  sourceReady: boolean;
  layoutMoving: boolean;
  canPair: (a: string, b: string) => boolean;
}
const wide = (): Shot => ({ kind: 'WIDE', userIds: [] });
const same = (a: Shot, b: Shot): boolean => a.kind === b.kind && a.userIds.join(',') === b.userIds.join(',');
export class ShotDirector {
  mode: DirectorMode = 'AUTO';
  private shot: Shot = wide();
  private holdUntil = -Infinity;
  private crowdSince: number | null = null;
  private crowdActive = false;
  private crowdReleaseUntil = -Infinity;
  private silenceSince: number | null = null;
  private missingSince: number | null = null;

  current(): Shot { return structuredClone(this.shot); }
  setMode(mode: DirectorMode): void { this.mode = mode; this.missingSince = null; }
  manual(shot: Shot, now: number): Decision { this.mode = 'MANUAL'; return this.choose(shot, 'MANUAL_OVERRIDE', now); }
  transitionEndsAt(now: number): void {
    if (this.shot.kind !== 'WIDE') this.holdUntil = now + C.minShotMs;
  }
  update(now: number, tracker: SpeakerTracker, context: DirectorContext): Decision {
    const ids = context.presentIds;
    const stats = ids.map(id => tracker.stats(id, now));
    const active = stats.filter(s => s.state === 'active');
    if (active.length) this.silenceSince = null;
    else if (this.silenceSince === null) this.silenceSince = now;

    if (!context.sourceReady || context.layoutMoving) {
      this.crowdSince = null; this.crowdActive = false; this.crowdReleaseUntil = -Infinity;
      return this.choose(wide(), !context.sourceReady ? 'SOURCE_LOST' : 'LAYOUT_GROWTH', now);
    }
    const missing = this.shot.userIds.some(id => !ids.includes(id));
    if (missing) {
      this.missingSince ??= now;
      if (this.mode === 'AUTO' || now - this.missingSince >= 1000) return this.choose(wide(), 'TARGET_LEFT', now);
    } else this.missingSince = null;
    if (this.mode !== 'AUTO') return this.keep('MANUAL_OVERRIDE', now);

    const turns = tracker.episodes(now, 4000).filter(e => ids.includes(e.userId));
    const collapsed = turns.filter((e, i) => i === 0 || turns[i - 1]!.userId !== e.userId);
    const rapid = new Set(collapsed.map(e => e.userId)).size >= 3 && collapsed.length - 1 >= 5;
    const overlap = active.length >= 3;
    if (overlap || rapid) {
      this.crowdSince ??= now;
      if (now - this.crowdSince >= C.crowdConfirmMs) {
        this.crowdActive = true;
        this.crowdReleaseUntil = now + C.crowdReleaseMs;
        return this.choose(wide(), overlap ? 'CROWD_OVERLAP' : 'CROWD_TURN_RATE', now);
      }
    } else {
      this.crowdSince = null;
      if (this.crowdActive) { this.crowdActive = false; this.crowdReleaseUntil = now + C.crowdReleaseMs; }
    }
    if (now < this.crowdReleaseUntil) return this.keep('CROWD_RELEASE_HOLD', now);
    if (now < this.holdUntil) return this.keep('MIN_SHOT_HOLD', now);

    const qualified = stats.filter(s => s.qualified).sort((a, b) => b.recentMs - a.recentMs || a.episodeStart - b.episodeStart || ids.indexOf(a.userId) - ids.indexOf(b.userId));
    const a = qualified[0], b = qualified[1];
    if (a && b && context.canPair(a.userId, b.userId)) return this.choose({ kind: 'TWO_SHOT', userIds: [a.userId, b.userId].sort((x, y) => ids.indexOf(x) - ids.indexOf(y)) as [string, string] }, 'NEARBY_DIALOGUE', now);

    const dialogue = tracker.episodes(now, C.turnWindowMs).filter(e => ids.includes(e.userId));
    const major = dialogue.filter((e, i) => i === 0 || dialogue[i - 1]!.userId !== e.userId).slice(-3);
    if (major.length === 3 && major[0]!.userId === major[2]!.userId && major[0]!.userId !== major[1]!.userId && active.some(s => major.some(e => e.userId === s.userId)) && context.canPair(major[0]!.userId, major[1]!.userId)) {
      const pair = [major[0]!.userId, major[1]!.userId].sort((x, y) => ids.indexOf(x) - ids.indexOf(y)) as [string, string];
      return this.choose({ kind: 'TWO_SHOT', userIds: pair }, 'NEARBY_DIALOGUE', now);
    }
    if (a) {
      if (this.shot.kind === 'SINGLE' && this.shot.userIds[0] !== a.userId) {
        const incumbent = stats.find(s => s.userId === this.shot.userIds[0]);
        if (incumbent && (incumbent.state === 'active' ? a.recentMs < incumbent.recentMs + 800 : incumbent.stoppedForMs < C.incumbentGraceMs)) return this.keep('INCUMBENT_PROTECTED', now);
      }
      return this.choose({ kind: 'SINGLE', userIds: [a.userId] }, 'SPEAKER_QUALIFIED', now);
    }
    if (this.silenceSince !== null && now - this.silenceSince >= C.silenceWideMs) return this.choose(wide(), 'SILENCE', now);
    return this.keep('BACKCHANNEL_IGNORED', now);
  }
  private keep(reason: string, now: number): Decision { return { shot: this.current(), reason, changed: false, holdRemainingMs: Math.max(0, this.holdUntil - now) }; }
  private choose(shot: Shot, reason: string, now: number): Decision {
    if (same(this.shot, shot)) return this.keep(reason, now);
    this.shot = structuredClone(shot);
    this.holdUntil = shot.kind === 'WIDE' ? -Infinity : now + C.minShotMs;
    return { shot: this.current(), reason, changed: true, holdRemainingMs: Math.max(0, this.holdUntil - now) };
  }
}
