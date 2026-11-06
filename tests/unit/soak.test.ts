import {expect,test} from 'bun:test';
import {DiagnosticJournal} from '../../src/diagnostics/journal.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoParticipant} from '../../src/replay/demo.ts';
test('two virtual hours with sixteen speakers preserve finite cameras, reservations and bounded diagnostics',()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'soak'}),people=Array.from({length:16},(_,i)=>demoParticipant(String(i+1)));
 const channelId=people[0]!.channelId;
 engine.apply({type:'snapshot',channel:{channelId,name:'Soak',kind:'guild-voice'},participants:people,receivedAtMs:0,sourceGeneration:1});
 engine.apply({type:'connection',status:'ready',receivedAtMs:0,sourceGeneration:1});
 const seats=engine.snapshot().session.reservations;const journal=new DiagnosticJournal();engine.observeEvents((event,ms)=>journal.event(event,ms));
 for(let now=0;now<7_200_000;now+=1000){
  const active=String(Math.floor(now/3000)%16+1),previous=String((Math.floor(now/3000)+15)%16+1);
  engine.apply({type:'speaking',userId:previous,state:'inactive',receivedAtMs:now,sourceGeneration:1});
  engine.apply({type:'speaking',userId:active,state:'active',receivedAtMs:now,sourceGeneration:1});
  for(let tick=now;tick<now+1000;tick+=50)engine.tick(tick);
  if(now%60000===0){const s=engine.snapshot();expect([...s.camera.to.position,...s.camera.to.target,s.straightLength].every(Number.isFinite)).toBe(true);expect(s.session.reservations).toEqual(seats);}
 }
 expect(engine.snapshot().session.capacity).toBe(16);expect(journal.snapshot().length).toBe(1000);
},60000);
