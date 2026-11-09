import type { AppSnapshot, Participant, SpeakingState } from '../../contracts/domain.ts';
import { compareIds } from '../../domain/seat-allocator.ts';

/** A reservation is not a fabricated Discord participant. Missing metadata stays explicit. */
export interface DockPerson {
  userId: string;
  name: string;
  slotIndex?: number;
  participant?: Participant;
  presence: Participant['presence'] | 'unverified';
  speaking: SpeakingState;
  canRelease: boolean;
}
export function dockPeople(state: AppSnapshot): DockPerson[] {
  const participants = new Map(state.participants.map(p => [p.userId, p]));
  const reservations = new Map(state.session.reservations.map(r => [r.userId, r]));
  const membershipKnown = state.connection === 'ready' && state.channel?.channelId === state.session.channelId;
  const ids = new Set([...participants.keys(), ...reservations.keys()]);
  return [...ids].filter(id=>reservations.has(id)||participants.get(id)?.presence!=='absent').map(userId => {
    const participant = participants.get(userId), reservation = reservations.get(userId);
    const presence = participant?.presence ?? (membershipKnown ? 'absent' : 'unverified');
    return {
      userId, name: participant?.displayName ?? `ID ${userId}（名前未取得）`,
      ...(reservation ? { slotIndex: reservation.slotIndex } : {}),
      ...(participant ? { participant } : {}), presence,
      speaking: participant?.speaking ?? 'unknown',
      canRelease: !!reservation && membershipKnown && presence === 'absent',
    } satisfies DockPerson;
  }).sort((a, b) => (a.slotIndex ?? Infinity) - (b.slotIndex ?? Infinity) || compareIds(a.userId, b.userId));
}
