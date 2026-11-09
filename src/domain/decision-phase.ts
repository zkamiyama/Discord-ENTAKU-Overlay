import type {Decision} from '../contracts/domain.ts';
export type DecisionPhase='STABLE'|'START_PENDING'|'END_CONFIRMING'|'END_GRACE'|'MANUAL'|'UNAVAILABLE';
/** Compatibility boundary for diagnostic reasons. Consumers use phase, not
 * English suffix matching; changing a displayed reason does not change a timer. */
export function decisionPhase(reason:string):DecisionPhase {
  switch(reason){
    case 'SPEECH_START_GRACE':return 'START_PENDING';
    case 'SPEECH_END_CONFIRM':case 'THIRD_SPEAKER_END_CONFIRM':return 'END_CONFIRMING';
    case 'SPEECH_END_GRACE':case 'THIRD_SPEAKER_END_GRACE':case 'TARGET_LEFT_GRACE':case 'SPLIT_RELEASE_GRACE':return 'END_GRACE';
    case 'MANUAL_OVERRIDE':return 'MANUAL';
    case 'SOURCE_LOST':return 'UNAVAILABLE';
    default:return 'STABLE';
  }
}
export function withDecisionPhase(decision:Decision):Decision {
  return {...decision,phase:decisionPhase(decision.reason)};
}
