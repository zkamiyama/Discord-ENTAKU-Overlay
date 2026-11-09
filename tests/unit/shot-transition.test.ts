import {test,expect} from 'bun:test';
import {transitionPhase,pendingTransition} from '../../src/domain/shot-transition.ts';
import {ShotDirector} from '../../src/domain/shot-director.ts';
import {SpeakerTracker} from '../../src/domain/speaker-tracker.ts';
test('absolute END boundaries are independent of the current camera hold',()=>{
 expect(transitionPhase('end',12500,14000,5000,7499)).toEqual({phase:'END_CONFIRMING',deadline:7500});
 expect(transitionPhase('end',12500,14000,5000,7500)).toEqual({phase:'END_GRACE',deadline:14000});
 expect(transitionPhase('end',12500,14000,5000,14000)).toEqual({phase:'STABLE'});
 expect(transitionPhase('start',1500,-Infinity,5000,1499)).toEqual({phase:'START_PENDING',deadline:1500});
});
test('a candidate preserves its onset only for the same shot and transition cause',()=>{
 const shot={kind:'SINGLE',userIds:['1']} as const;
 const a=pendingTransition(null,{...shot,userIds:['1']},'a','start',1500,1000);
 const b=pendingTransition(a,a.shot,'b','start',1700,1200);expect(b.since).toBe(1000);expect(a.reason).toBe('a');
 expect(pendingTransition(b,b.shot,'stop','end',9000,4000).since).toBe(4000);
 b.shot.userIds[0]='2';expect(a.shot.userIds[0]).toBe('1');
});
test('director emits explicit phases for start, hesitation, end and manual control',()=>{
 const t=new SpeakerTracker(),d=new ShotDirector(),ctx={presentIds:['1'],sourceReady:true,layoutMoving:false,canPair:()=>false};
 t.update('1','active',0);expect(d.update(1000,t,ctx).phase).toBe('START_PENDING');
 expect(d.update(1499,t,ctx).phase).toBe('START_PENDING');
 expect(d.update(1500,t,ctx).shot.kind).toBe('SINGLE');
 t.update('1','inactive',5000);expect(d.update(5000,t,ctx).phase).toBe('END_CONFIRMING');
 expect(d.update(7500,t,ctx).phase).toBe('END_GRACE');expect(d.update(12500,t,ctx).phase).toBe('STABLE');
 expect(d.manual({kind:'SINGLE',userIds:['1']},13000).phase).toBe('MANUAL');
 expect(d.update(13001,t,{...ctx,sourceReady:false}).phase).toBe('UNAVAILABLE');
});
