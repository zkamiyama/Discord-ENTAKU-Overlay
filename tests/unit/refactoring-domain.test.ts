import {test,expect} from 'bun:test';
import {CameraContext} from '../../src/domain/camera-context.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';
import {newSession} from '../../src/domain/seat-allocator.ts';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
import {DEFAULT_DIRECTION} from '../../src/studio/direction.ts';
import {withDecisionPhase} from '../../src/domain/decision-phase.ts';

test('camera context memoizes geometry and pair feasibility until invalidated',()=>{
 const c=new CameraContext(),layout=makeLayout(4),session=newSession('1','test');let reads=0,pairs=0;
 const read=()=>{reads++;return session;},members=new Map(),profiles=new Map();
 const a=c.geometry(read,layout,members,profiles);expect(c.geometry(read,layout,members,profiles)).toBe(a);expect(reads).toBe(1);
 expect(c.pair('1','2',()=>{pairs++;return true;})).toBe(true);expect(c.pair('2','1',()=>false)).toBe(true);expect(pairs).toBe(1);
 c.invalidate();expect(c.geometry(read,layout,members,profiles)).not.toBe(a);expect(c.pair('1','2',()=>false)).toBe(false);
});
test('speech caches are invalidated by events and window settings at the same clock',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);
 const a=t.stats('1',10000);a.windowMs=-1;expect(t.stats('1',10000).windowMs).toBe(10000);
 t.configure({...DEFAULT_DIRECTION,leadershipWindowSeconds:3});expect(t.stats('1',10000).windowMs).toBe(3000);
 const intervals=t.intervals('1',10000);intervals[0]!.start=0;expect(t.intervals('1',10000)[0]!.start).toBe(7000);
 t.update('1','inactive',10000);expect(t.stats('1',10000).state).toBe('inactive');
 t.clear();expect(t.stats('1',10000).state).toBe('unknown');
});
test('decision phase represents countdown intent without clients interpreting reason text',()=>{
 for(const [reason,phase] of [['SPEECH_START_GRACE','START_PENDING'],['THIRD_SPEAKER_END_CONFIRM','END_CONFIRMING'],['THIRD_SPEAKER_END_GRACE','END_GRACE'],['MANUAL_OVERRIDE','MANUAL'],['SOURCE_LOST','UNAVAILABLE'],['BALANCED_DIALOGUE','STABLE']] as const){
  expect(withDecisionPhase({shot:{kind:'WIDE',userIds:[]},changed:false,reason:reason!,holdRemainingMs:10}).phase).toBe(phase);
 }
});
