import type { Participant, ProviderEvent } from '../contracts/domain.ts';
export function demoParticipant(userId: string, name = `ゲスト ${userId}`): Participant {
  return { userId, channelId: '200', username: name, displayName: name, presence: 'present', speaking: 'unknown',
    voice: { selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false } };
}
export function demoEvents(now = 0): ProviderEvent[] {
  const participants = ['アオイ','ミナト','ハル','ユイ','ソラ','レン'].map((name, i) => demoParticipant(String(100 + i), name));
  return [
    { sourceGeneration: 1, receivedAtMs: now, type: 'connection', status: 'ready' },
    { sourceGeneration: 1, receivedAtMs: now, type: 'snapshot', channel: { channelId: '200', name: 'デモ VC', kind: 'guild-voice' }, participants },
  ];
}
