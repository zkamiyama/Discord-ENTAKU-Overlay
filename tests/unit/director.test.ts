import {expect,test} from 'bun:test';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
import {ShotDirector,type DirectorContext} from '../../src/domain/shot-director.ts';
const ctx:DirectorContext={presentIds:['1','2','3'],sourceReady:true,layoutMoving:false,canPair:()=>true};
test('first speaker switches at 2.5s total, not 1s qualification plus another delay',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);
 expect(d.update(999,t,ctx).shot.kind).toBe('WIDE');expect(d.update(1000,t,ctx).switchAtMs).toBe(2500);
 expect(d.update(2499,t,ctx).shot.kind).toBe('WIDE');expect(d.update(2500,t,ctx).shot.userIds).toEqual(['1']);
 t.update('2','active',3000);d.update(4000,t,ctx);t.update('2','inactive',4200);
 expect(d.update(4200,t,ctx).pendingShot).toBeUndefined();expect(d.update(10000,t,ctx).shot.userIds).toEqual(['1']);
});
test('TWO_SHOT waits five seconds from STOP and a returning speaker cancels narrowing',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);t.update('2','active',0);d.update(1000,t,ctx);
 expect(d.update(2500,t,ctx).shot.kind).toBe('TWO_SHOT');
 t.update('2','inactive',6000);expect(d.update(6000,t,ctx).switchAtMs).toBe(11000);
 expect(d.update(10999,t,ctx).shot.kind).toBe('TWO_SHOT');
 t.update('2','active',10999);expect(d.update(10999,t,ctx).pendingShot).toBeUndefined();
 t.update('2','inactive',11500);expect(d.update(11500,t,ctx).switchAtMs).toBe(16500);
 expect(d.update(16499,t,ctx).shot.kind).toBe('TWO_SHOT');expect(d.update(16500,t,ctx).shot.userIds).toEqual(['1']);
});
test('silence waits five seconds from actual STOP and resumes without a wide cut',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(2500,t,ctx);
 t.update('1','inactive',4000);expect(d.update(4100,t,ctx).switchAtMs).toBe(9000);
 expect(d.update(8999,t,ctx).shot.kind).toBe('SINGLE');t.update('1','active',8999);
 expect(d.update(8999,t,ctx).shot.kind).toBe('SINGLE');
 t.update('1','inactive',10000);d.update(10000,t,ctx);expect(d.update(15000,t,ctx).reason).toBe('SILENCE');
});
test('a new turn can replace a finished speaker after 2.5s, not a summed seven-second wait',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(2500,t,ctx);
 t.update('1','inactive',5000);t.update('2','active',5000);d.update(6000,t,ctx);
 expect(d.update(7499,t,ctx).shot.userIds).toEqual(['1']);expect(d.update(7500,t,ctx).shot.userIds).toEqual(['2']);
});
test('10-second leader wins over multiple backchannels and balanced speech permits a pair',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();t.update('1','active',0);d.update(2500,t,ctx);
 for(const start of [3000,5000,7000]){t.update('2','active',start);d.update(start+1000,t,ctx);t.update('2','inactive',start+1100);expect(d.update(start+1100,t,ctx).shot.userIds).toEqual(['1']);}
 t.update('2','active',8500);d.update(9500,t,ctx);expect(d.update(11000,t,ctx).leaderUserId).toBe('1');
 t.update('1','inactive',12000);d.update(12000,t,ctx);expect(d.update(14500,t,ctx).shot.userIds).toEqual(['2']);
 const b=new ShotDirector(),s=new SpeakerTracker();s.update('1','active',0);s.update('2','active',0);expect(b.update(2500,s,ctx).shot.kind).toBe('TWO_SHOT');
});
test('leader change must persist, and recent-window clipping lets a new leader take over',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector(),noPair={...ctx,canPair:()=>false};
 t.update('1','active',0);d.update(2500,t,noPair);t.update('2','active',3000);d.update(5500,t,noPair);
 expect(d.current().userIds).toEqual(['1']);t.update('1','inactive',6000);d.update(6000,t,noPair);
 expect(d.current().userIds).toEqual(['2']);
 t.update('1','active',6500);d.update(7500,t,noPair);expect(d.update(9000,t,noPair).shot.userIds).toEqual(['2']);
 expect(t.stats('2',14000).windowMs).toBe(10000);expect(t.stats('1',14000).windowMs).toBe(9500);
});
test('crowd retirement also waits five seconds rather than immediately selecting the remaining person',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector();for(const id of ctx.presentIds)t.update(id,'active',0);
 d.update(2500,t,ctx);for(const id of ['2','3'])t.update(id,'inactive',4000);
 expect(d.update(4000,t,ctx).switchAtMs).toBe(9000);expect(d.update(8999,t,ctx).shot.kind).toBe('WIDE');expect(d.update(9000,t,ctx).shot.userIds).toEqual(['1']);
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
