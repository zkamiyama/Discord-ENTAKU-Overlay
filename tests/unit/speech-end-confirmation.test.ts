import {DEFAULT_DIRECTION} from '../../src/studio/direction.ts';
const LEGACY_TIMING={...DEFAULT_DIRECTION,startGraceSeconds:2.5};
import {expect,test} from 'bun:test';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
import {ShotDirector,type DirectorContext} from '../../src/domain/shot-director.ts';
const context:DirectorContext={presentIds:['1','2','3'],sourceReady:true,layoutMoving:false,canPair:()=>true,splitEnabled:true,canSplit:()=>true};
function split(){const t=new SpeakerTracker(),d=new ShotDirector(LEGACY_TIMING);for(const id of ['1','2'])t.update(id,'active',0);d.update(2500,t,context);d.update(5000,t,context);expect(d.update(7500,t,context).shot.kind).toBe('SPLIT');return {t,d};}
test('raw STOP remains inactive but the conversation pauses for exactly 2500ms',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);t.update('1','inactive',4000);
 expect(t.stats('1',4000).state).toBe('inactive');
 expect(t.conversationStats('1',6499)).toMatchObject({state:'active',rawState:'inactive',qualified:true,activeMs:4000,windowMs:4000,endPendingUntilMs:6500});
 expect(t.conversationStats('1',6500)).toMatchObject({state:'inactive',qualified:false,stoppedForMs:0});
 expect(t.conversationStats('1',7500).stoppedForMs).toBe(1000);
});
test('resuming a qualified turn during a hesitation needs no new qualification',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);t.update('1','inactive',4000);t.update('1','active',6499);
 expect(t.stats('1',6499).qualified).toBe(false);
 expect(t.conversationStats('1',6499)).toMatchObject({state:'active',qualified:true,activeMs:4000,episodeStart:0});
 expect(t.conversationStats('1',7000).activeMs).toBe(4501);
 expect(t.stats('1',7000).windowMs).toBe(4501);
 expect(t.intervals('1',7000)).toEqual([{start:0,end:4000},{start:6499,end:7000}]);
});
test('a gap of exactly 2500ms establishes a new turn instead of retaining qualification',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);t.update('1','inactive',4000);t.update('1','active',6500);
 expect(t.conversationStats('1',6500)).toMatchObject({qualified:false,activeMs:0,episodeStart:6500});
});
test('repeated STOP cannot extend confirmation, and unknown clears the conversation',()=>{
 const t=new SpeakerTracker();t.update('1','active',0);t.update('1','inactive',4000);t.update('1','inactive',5000);
 expect(t.conversationStats('1',5000).endPendingUntilMs).toBe(6500);
 t.update('1','unknown',5500);expect(t.conversationStats('1',5500).state).toBe('unknown');expect(t.conversationStats('1',5500).endPendingUntilMs).toBeUndefined();
});
test('silence neither earns onset time nor turns a short acknowledgement into a qualified turn',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector(LEGACY_TIMING);t.update('1','active',0);t.update('1','inactive',400);
 for(const at of [1000,2000,2899]){expect(t.conversationStats('1',at).activeMs).toBe(400);expect(t.conversationStats('1',at).qualified).toBe(false);expect(d.update(at,t,context).shot.kind).toBe('WIDE');}
});
test('a split survives a two-second hesitation and renewed speech cancels both end phases',()=>{
 const {t,d}=split();t.update('2','inactive',8000);expect(d.update(8000,t,context).reason).toBe('SPEECH_END_CONFIRM');
 expect(d.update(9999,t,context).shot.kind).toBe('SPLIT');t.update('2','active',10000);
 const resumed=d.update(10000,t,context);expect(resumed.shot.kind).toBe('SPLIT');expect(resumed.pendingShot).toBeUndefined();expect(resumed.switchAtMs).toBeUndefined();
 t.update('2','inactive',12000);d.update(12000,t,context);expect(d.update(14500,t,context).switchAtMs).toBe(19500);
 t.update('2','active',19499);expect(d.update(19499,t,context).shot.kind).toBe('SPLIT');expect(d.update(19499,t,context).switchAtMs).toBeUndefined();
});
test('third-person takeover waits for the later former speaker, including confirmation',()=>{
 const {t,d}=split();t.update('3','active',8000);d.update(9000,t,context);expect(d.update(10500,t,context).shot.kind).toBe('WIDE');
 t.update('1','inactive',11000);t.update('2','inactive',12000);
 expect(d.update(13000,t,context)).toMatchObject({reason:'THIRD_SPEAKER_END_CONFIRM',switchAtMs:14500});
 expect(d.update(14500,t,context)).toMatchObject({reason:'THIRD_SPEAKER_END_GRACE',switchAtMs:19500});
 expect(d.update(18500,t,context).shot.kind).toBe('WIDE');expect(d.update(19499,t,context).shot.kind).toBe('WIDE');
 expect(d.update(19500,t,context).shot).toEqual({kind:'SINGLE',userIds:['3']});
});
test('manual override and connection loss do not wait for speech-end confirmation',()=>{
 const {t,d}=split();t.update('2','inactive',8000);d.update(8000,t,context);
 expect(d.manual({kind:'SINGLE',userIds:['3']},8100).shot.userIds).toEqual(['3']);
 expect(d.update(8200,t,{...context,sourceReady:false}).shot.kind).toBe('WIDE');
});

test('onset across a hesitation accumulates real speech only, not the silent gap',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector(LEGACY_TIMING);t.update('1','active',0);t.update('1','inactive',650);
 d.update(2000,t,context);t.update('1','active',2650);
 expect(d.update(4499,t,context).shot.kind).toBe('WIDE');
 expect(t.conversationStats('1',4499).activeMs).toBe(2499);
 expect(d.update(4500,t,context).shot).toEqual({kind:'SINGLE',userIds:['1']});
 expect(t.stats('1',4500).windowMs).toBe(2500);
});
