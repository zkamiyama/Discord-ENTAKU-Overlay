import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoParticipant} from '../../src/replay/demo.ts';

function fixture(){
 const engine=new AppEngine({source:'demo',serverEpoch:'retention'});
 engine.apply({type:'snapshot',channel:{channelId:'200',name:'room',kind:'guild-voice'},participants:Array.from({length:32},(_,i)=>({...demoParticipant(String(i+1)),channelId:'200'})),sourceGeneration:1,receivedAtMs:0});
 engine.apply({type:'connection',status:'ready',sourceGeneration:1,receivedAtMs:1});engine.tick(2000);
 return engine;
}
test('unassigned departures do not accumulate metadata while reserved departures retain their identities',()=>{
 const engine=fixture(),original=engine.snapshot().session.reservations;
 let now=3000;
 for(let id=33;id<=132;id++){
  engine.apply({type:'participant-upsert',participant:{...demoParticipant(String(id)),channelId:'200'},sourceGeneration:1,receivedAtMs:now});
  engine.apply({type:'participant-left',userId:String(id),sourceGeneration:1,receivedAtMs:now+1});
  engine.tick(now+600);now+=1000;
 }
 expect(engine.snapshot().participants).toHaveLength(32);
 expect(engine.snapshot().session.reservations).toEqual(original);
 const name=engine.participant('1')!.displayName;
 engine.apply({type:'participant-left',userId:'1',sourceGeneration:1,receivedAtMs:now});engine.tick(now+600);
 expect(engine.participant('1')).toMatchObject({presence:'absent',displayName:name});
 engine.control({type:'release',userId:'1'},engine.currentRevision,now+700);
 expect(engine.participant('1')).toBeUndefined();expect(engine.snapshot().participants).toHaveLength(31);
 engine.apply({type:'participant-upsert',participant:{...demoParticipant('1'),channelId:'200'},sourceGeneration:1,receivedAtMs:now+800});engine.tick(now+1400);
 expect(engine.participant('1')?.presence).toBe('present');expect(engine.snapshot().session.reservations).toHaveLength(32);
});
