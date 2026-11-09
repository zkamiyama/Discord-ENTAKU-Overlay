import {expect,test} from 'bun:test';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
import {ShotDirector,type DirectorContext} from '../../src/domain/shot-director.ts';
const ctx:DirectorContext={presentIds:['1','2','3'],sourceReady:true,layoutMoving:false,canPair:()=>true};
test('qualified first speaker waits five seconds; a short candidate cannot cut',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);
 expect(d.update(999,t,ctx).shot.kind).toBe('WIDE');expect(d.update(1000,t,ctx).switchAtMs).toBe(6000);
 expect(d.update(5999,t,ctx).shot.kind).toBe('WIDE');expect(d.update(6000,t,ctx).shot.userIds).toEqual(['1']);
 t.update('2','active',7000);d.update(8000,t,ctx);t.update('2','inactive',8200);
 expect(d.update(8200,t,ctx).pendingShot).toBeUndefined();expect(d.update(14000,t,ctx).shot.userIds).toEqual(['1']);
});
test('TWO_SHOT to SINGLE has its own five-second cancellable grace',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);t.update('2','active',0);d.update(1000,t,ctx);d.update(6000,t,ctx);
 expect(d.current().kind).toBe('TWO_SHOT');
 t.update('2','inactive',12000);expect(d.update(12000,t,ctx).switchAtMs).toBe(17000);
 expect(d.update(16999,t,ctx).shot.kind).toBe('TWO_SHOT');expect(d.update(17000,t,ctx).shot.userIds).toEqual(['1']);
});
test('crowd and silence use five seconds too, not the old 700ms override',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(1000,t,ctx);d.update(6000,t,ctx);
 t.update('2','active',12000);t.update('3','active',12000);expect(d.update(12000,t,ctx).switchAtMs).toBe(17000);
 expect(d.update(16999,t,ctx).shot.kind).toBe('SINGLE');expect(d.update(17000,t,ctx).shot.kind).toBe('WIDE');
 d.manual({kind:'SINGLE',userIds:['1']},18000);d.setMode('AUTO');
 for(const id of ctx.presentIds)t.update(id,'inactive',24000);
 expect(d.update(24000,t,ctx).switchAtMs).toBe(29000);expect(d.update(28999,t,ctx).shot.kind).toBe('SINGLE');expect(d.update(29000,t,ctx).reason).toBe('SILENCE');
});
test('candidate replacement restarts grace and returning to the current shot cancels it',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(1000,t,ctx);d.update(6000,t,ctx);
 t.update('2','active',12000);d.update(13000,t,ctx);t.update('3','active',14000);
 expect(d.update(14000,t,ctx).switchAtMs).toBe(19000);expect(d.update(18000,t,ctx).shot.kind).toBe('SINGLE');
 t.update('2','inactive',18500);t.update('3','inactive',18500);expect(d.update(18500,t,ctx).pendingShot).toBeUndefined();
 expect(d.update(21000,t,ctx).shot.kind).toBe('SINGLE');
});
test('manual shots expire in ten seconds and repeated clicks renew the lease',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();d.manual({kind:'SINGLE',userIds:['1']},0);expect(d.autoResumeAtMs).toBe(10000);
 d.update(9999,t,ctx);expect(d.mode).toBe('MANUAL');d.manual({kind:'SINGLE',userIds:['1']},9999);expect(d.autoResumeAtMs).toBe(19999);
 expect(d.update(19999,t,ctx).shot.kind).toBe('SINGLE');expect(d.mode).toBe('AUTO');expect(d.autoResumeAtMs).toBeNull();
 expect(d.update(24998,t,ctx).shot.kind).toBe('SINGLE');expect(d.update(24999,t,ctx).shot.kind).toBe('WIDE');
});
test('AUTO off is a persistent fixed shot; an explicit shot never waits for grace',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();d.manual({kind:'SINGLE',userIds:['1']},0);d.setMode('HOLD');
 expect(d.autoResumeAtMs).toBeNull();expect(d.manual({kind:'SINGLE',userIds:['2']},10).changed).toBe(true);
 d.update(100000,t,ctx);expect(d.mode).toBe('HOLD');expect(d.current().userIds).toEqual(['2']);
 d.setMode('AUTO');d.update(100000,t,ctx);expect(d.update(104999,t,ctx).shot.kind).toBe('SINGLE');expect(d.update(105000,t,ctx).shot.kind).toBe('WIDE');
});
test('only source loss and layout safety bypass the conversational timer',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();d.manual({kind:'SINGLE',userIds:['1']},0);d.setMode('HOLD');
 expect(d.update(100,t,{...ctx,sourceReady:false}).reason).toBe('SOURCE_LOST');
 d.manual({kind:'SINGLE',userIds:['2']},200);expect(d.update(201,t,{...ctx,layoutMoving:true}).reason).toBe('LAYOUT_GROWTH');
});
test('a target who leaves has five seconds of grace even in manual mode',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();d.manual({kind:'SINGLE',userIds:['1']},0);
 expect(d.update(100,t,{...ctx,presentIds:[]}).shot.kind).toBe('SINGLE');expect(d.update(5099,t,{...ctx,presentIds:[]}).shot.kind).toBe('SINGLE');
 expect(d.update(5100,t,{...ctx,presentIds:[]}).shot.kind).toBe('WIDE');
});
