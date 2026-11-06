import { expect,test } from 'bun:test';
import { SpeakerTracker } from '../../src/domain/speaker-tracker.ts';
import { ShotDirector,type DirectorContext } from '../../src/domain/shot-director.ts';
const ctx:DirectorContext={presentIds:['1','2','3'],sourceReady:true,layoutMoving:false,canPair:()=>false};
test('first speaker is framed at 1s and a 300ms backchannel does not cut',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);
 expect(d.update(999,t,ctx).shot.kind).toBe('WIDE');expect(d.update(1000,t,ctx).shot.userIds).toEqual(['1']);
 t.update('2','active',1500);d.update(1500,t,ctx);t.update('2','inactive',1800);
 expect(d.update(4000,t,ctx).shot.userIds).toEqual(['1']);
});
test('crowd overrides min-shot at 700ms and release is held for 1200ms',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(1000,t,ctx);
 t.update('2','active',1100);t.update('3','active',1100);d.update(1100,t,ctx);
 expect(d.update(1799,t,ctx).shot.kind).toBe('SINGLE');expect(d.update(1800,t,ctx).reason).toBe('CROWD_OVERLAP');
 t.update('2','inactive',1900);t.update('3','inactive',1900);d.update(1900,t,ctx);
 expect(d.update(3099,t,ctx).shot.kind).toBe('WIDE');expect(d.update(3100,t,ctx).shot.kind).toBe('SINGLE');
});
test('nearby qualified pair waits for min shot and then uses TWO_SHOT',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(1000,t,ctx);t.update('2','active',1200);
 const near={...ctx,canPair:()=>true};expect(d.update(3499,t,near).shot.kind).toBe('SINGLE');
 expect(d.update(3500,t,near).shot.kind).toBe('TWO_SHOT');
});
test('disconnect and layout growth force wide even in HOLD',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(1000,t,ctx);d.setMode('HOLD');
 expect(d.update(1100,t,{...ctx,sourceReady:false}).reason).toBe('SOURCE_LOST');
 expect(d.update(1200,t,{...ctx,layoutMoving:true}).reason).toBe('LAYOUT_GROWTH');
});
test('manual missing target gets 1s grace, then leaves the empty face',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();d.manual({kind:'SINGLE',userIds:['1']},0);
 const empty={...ctx,presentIds:[]};expect(d.update(100,t,empty).shot.kind).toBe('SINGLE');
 expect(d.update(1099,t,empty).shot.kind).toBe('SINGLE');expect(d.update(1100,t,empty).shot.kind).toBe('WIDE');
});
test('gaps and minimum hold protect a completed camera transition',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(1000,t,ctx);d.transitionEndsAt(1900);
 t.update('1','inactive',2000);t.update('2','active',2100);
 expect(d.update(4399,t,ctx).shot.userIds).toEqual(['1']);expect(d.update(4400,t,ctx).shot.userIds).toEqual(['2']);
});
