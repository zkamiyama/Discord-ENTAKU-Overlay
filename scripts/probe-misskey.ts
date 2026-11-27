import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { MisskeyRejectReason, MisskeyState, MisskeyStatus } from '../src/contracts/misskey.ts';
import { MisskeyFeed } from '../src/misskey/feed.ts';
import { DEFAULT_MISSKEY_SETTINGS } from '../src/misskey/settings.ts';
import { MisskeyStream } from '../src/misskey/stream.ts';

export interface MisskeyProbeArguments { seconds: number; includeHome: boolean; output: string | null; help: boolean }
export function parseMisskeyProbeArguments(args: readonly string[]): MisskeyProbeArguments {
  const options: MisskeyProbeArguments = { seconds: 180, includeHome: false, output: null, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--include-home') options.includeHome = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--seconds') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 10 || Number(value) > 600) throw new Error('MISSKEY_PROBE_SECONDS_INVALID');
      options.seconds = Number(value);
    } else if (arg === '--output') {
      const value = args[++i];
      if (!value || value.startsWith('--') || value.includes('\0')) throw new Error('MISSKEY_PROBE_OUTPUT_INVALID');
      options.output = resolve(value);
    } else throw new Error('MISSKEY_PROBE_ARGUMENT_INVALID');
  }
  return options;
}

interface Metrics {
  status: MisskeyStatus;
  errorCode: string | null;
  retryAt: number | null;
  received: number;
  accepted: number;
  rejected: Partial<Record<MisskeyRejectReason, number>>;
  reconnects: number;
  recoveryTruncated: boolean;
  lastEventAt: number | null;
}
/** Deliberately enumerate fields: a snapshot also contains public note text and identities. */
function metrics(state: MisskeyState): Metrics {
  return { status: state.status, errorCode: state.errorCode, retryAt: state.retryAt,
    received: state.received, accepted: state.accepted, rejected: { ...state.rejected },
    reconnects: state.reconnects, recoveryTruncated: state.recoveryTruncated, lastEventAt: state.lastEventAt };
}

export async function runMisskeyProbe(args = process.argv.slice(2)): Promise<void> {
  const options = parseMisskeyProbeArguments(args);
  if (options.help) {
    console.log('ENTAKU Misskey read-only probe: https://otomad.site #NicoMiss\nOptions: --seconds 10..600 (default 180), --include-home, --output <json>, --help\nRecords connection transitions and counters only. Does not post notes or save note text, authors, IDs, or proxy settings.');
    return;
  }
  const testedSources = await Promise.all([
    '../src/contracts/misskey.ts', '../src/misskey/settings.ts', '../src/misskey/moderation.ts',
    '../src/misskey/feed.ts', '../src/misskey/stream.ts', './probe-misskey.ts',
  ].map(async path => ({ path: path.replace(/^\.\.\//, '').replace(/^\.\//, 'scripts/'),
    sha256: new Bun.CryptoHasher('sha256').update(await Bun.file(new URL(path, import.meta.url)).arrayBuffer()).digest('hex') })));
  const settings = { ...structuredClone(DEFAULT_MISSKEY_SETTINGS), enabled: true, includeHome: options.includeHome };
  const feed = new MisskeyFeed(settings);
  const stream = new MisskeyStream(feed);
  const startedAt = Date.now();
  const transitions: ({ at: string; elapsedMs: number } & Metrics)[] = [];
  let lastTransition = '';
  let observedLive = false;
  const record = (state: MisskeyState): void => {
    const key = JSON.stringify([state.status, state.errorCode, state.retryAt, state.recoveryTruncated]);
    if (state.status === 'live') observedLive = true;
    if (key === lastTransition) return;
    lastTransition = key;
    const transition = { at: new Date().toISOString(), elapsedMs: Date.now() - startedAt, ...metrics(state) };
    transitions.push(transition);
    console.log('[MISSKEY-PROBE] ' + JSON.stringify(transition));
  };
  const off = feed.observe(record);
  let finish!: () => void;
  let termination: 'duration' | 'signal' = 'duration';
  const finished = new Promise<void>(done => { finish = done; });
  const signal = (): void => { termination = 'signal'; finish(); };
  const tick = setInterval(() => feed.tick(), 50);
  const timeout = setTimeout(finish, options.seconds * 1000);
  process.on('SIGINT', signal);
  process.on('SIGTERM', signal);
  let final: Metrics;
  try {
    console.log('[MISSKEY-PROBE] ' + JSON.stringify({ startedAt: new Date(startedAt).toISOString(), seconds: options.seconds, includeHome: options.includeHome }));
    record(feed.snapshot());
    stream.start();
    await finished;
    final = metrics(feed.snapshot());
  } finally {
    clearTimeout(timeout);
    clearInterval(tick);
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    off();
    stream.dispose();
    feed.dispose();
  }
  const endedAt = Date.now();
  const summary = {
    schemaVersion: 1,
    testedSources,
    startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt, requestedSeconds: options.seconds, includeHome: options.includeHome, termination,
    transitions, final, observedLive,
    verdict: !observedLive ? 'CONNECTION_NOT_CONFIRMED' : final.lastEventAt !== null ? 'LIVE_EVENT_OBSERVED'
      : final.reconnects > 0 ? 'CONNECTED_WITH_RECONNECTS_NO_NEW_NOTES' : 'CONNECTION_MAINTAINED_NO_NEW_NOTES',
  };
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await Bun.write(options.output, JSON.stringify(summary, null, 2) + '\n');
  }
  console.log('[MISSKEY-PROBE] SUMMARY ' + JSON.stringify(summary));
  process.exitCode = observedLive ? 0 : 2;
}

if (import.meta.main) {
  try { await runMisskeyProbe(); }
  catch (error) {
    console.error(error instanceof Error && /^MISSKEY_PROBE_[A-Z_]+$/.test(error.message) ? error.message : 'MISSKEY_PROBE_FAILED');
    process.exitCode = 2;
  }
}
