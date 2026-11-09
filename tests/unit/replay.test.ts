import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {parseReplay,ReplayPlayer} from '../../src/replay/player.ts';
function fixture() {
 return [JSON.stringify({kind:'header',schemaVersion:1,originMs:0,durationMs:8000}),
 ...demoEvents().map(event=>JSON.stringify({kind:'provider',atMs:0,event})),
 JSON.stringify({kind:'provider',atMs:2000,event:{type:'speaking',userId:'100',state:'active',sourceGeneration:1,receivedAtMs:2000}}),
 JSON.stringify({kind:'provider',atMs:5500,event:{type:'speaking',userId:'100',state:'inactive',sourceGeneration:1,receivedAtMs:5500}})].join('\n');
}
function engine(){return new AppEngine({source:'replay',serverEpoch:'fixture',utcNow:()=> '2026-11-06T00:00:00Z',sessionId:()=> 'fixture'});}
test('incremental and accelerated virtual replay produce identical camera and seat state',()=>{
 const replay=parseReplay(fixture()),a=engine(),b=engine(),pa=new ReplayPlayer(replay,a),pb=new ReplayPlayer(replay,b);
 for(let t=0;t<=8000;t+=50)pa.advanceTo(t);
 pb.advanceTo(8000);
 expect(a.snapshot()).toEqual(b.snapshot());// The 3.5s turn qualifies at 4.5s and remains framed until STOP + 5s.
 expect(a.snapshot().camera.shot.kind).toBe('SINGLE');
});
test('invalid replay clocks and state cannot enter the domain',()=>{
 expect(()=>parseReplay(fixture().replace('"state":"active"','"state":"loud"'))).toThrow('INVALID_REPLAY_EVENT');
 expect(()=>parseReplay(fixture().replace('"atMs":5500','"atMs":1000'))).toThrow('INVALID_REPLAY_ORDER');
 const p=new ReplayPlayer(parseReplay(fixture()),engine());p.advanceTo(500);expect(()=>p.advanceTo(499)).toThrow('REPLAY_CLOCK_REGRESSION');
});
