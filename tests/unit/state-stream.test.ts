import {expect,test} from 'bun:test';
import {StatePublisher,StateReceiver,STATE_PROTOCOL} from '../../src/contracts/state-stream.ts';
import {AppEngine} from '../../src/domain/engine.ts';
const make=()=>new AppEngine({source:'demo',serverEpoch:'stream-test'}).snapshot();
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
test('full and delta reconstruct the identical JSON state and retain unchanged sections',()=>{
 const sender=new StatePublisher(),reader=new StateReceiver(),first=make();
 expect(first.protocolVersion).toBe(STATE_PROTOCOL);
 const full=sender.publish(first),received=reader.accept(JSON.parse(full.full()))!;
 expect(received).toEqual(json(first));expect(Object.isFrozen(received.studio)).toBe(true);
 const second={...first,serverNowMs:100,errorCode:'TEST'};
 const packet=sender.publish(second);
 const message=JSON.parse(packet.delta!);expect(message.changes).toEqual({serverNowMs:100,errorCode:'TEST'});
 const updated=reader.accept(message)!;
 expect(updated).toEqual(json(second));expect(updated.studio).toBe(received.studio);
 const third=sender.publish({...first,serverNowMs:200});
 expect(JSON.parse(third.delta!).removed).toEqual(['errorCode']);
 expect(reader.accept(JSON.parse(third.delta!))).toEqual(json({...first,serverNowMs:200}));
});
test('missed frames and epoch changes require a full snapshot without corrupting baseline',()=>{
 const sender=new StatePublisher(),receiver=new StateReceiver(),first=make();
 const a=sender.publish(first);receiver.accept(JSON.parse(a.full()));
 sender.publish({...first,serverNowMs:100});
 const c=sender.publish({...first,serverNowMs:200});
 expect(receiver.accept(JSON.parse(c.delta!))).toBeNull();
 expect(receiver.accept(JSON.parse(c.full()))?.serverNowMs).toBe(200);
 const d=sender.publish({...first,serverEpoch:'new-epoch',serverNowMs:0});
 expect(d.delta).toBeUndefined();expect(receiver.accept(JSON.parse(d.full()))?.serverEpoch).toBe('new-epoch');
 expect(receiver.accept(JSON.parse(c.full()))).toBeNull();
});
test('configuration is sent only after revision changes; invalid field changes are rejected',()=>{
 const sender=new StatePublisher(),receiver=new StateReceiver(),state=make();
 receiver.accept(JSON.parse(sender.publish(state).full()));
 const next={...state,revision:1,studio:{...state.studio,revision:1,gaussian:{lodSplatCount:1000}}};
 const packet=sender.publish(next),delta=JSON.parse(packet.delta!);
 expect(delta.changes.studio.gaussian.lodSplatCount).toBe(1000);
 expect(receiver.accept({...delta,changes:{unknown:true}})).toBeNull();
 expect(receiver.accept({...delta,removed:['studio']})).toBeNull();
 expect(receiver.accept(delta)).toEqual(json(next));
 sender.reset();expect(sender.publish(next).delta).toBeUndefined();
});

test('repeated full frames preserve immutable identity and cannot replace a known frame',()=>{
 const sender=new StatePublisher(),receiver=new StateReceiver(),state=make();
 const packet=JSON.parse(sender.publish(state).full()),first=receiver.accept(packet);
 expect(receiver.accept(json(packet))).toBe(first);
 expect(receiver.accept({...packet,state:{...packet.state,mode:'HOLD'}})).toBe(first);
 expect(receiver.accept({...packet,state:{...packet.state,serverEpoch:'other'}})).toBeNull();
});

test('malformed nested sections and regressed revisions leave the baseline usable',()=>{
 const sender=new StatePublisher(),receiver=new StateReceiver(),state={...make(),seq:10,revision:10};
 const first=receiver.accept(JSON.parse(sender.publish(state).full()));
 const delta=JSON.parse(sender.publish({...state,serverNowMs:100}).delta!);
 const bad:Record<string,unknown>[]=[
  {seq:9},{revision:9},{mode:'invalid'},{source:'old'},{straightLength:null},
  {studio:{}},{session:{}},{camera:{}},{decision:{}},{seats:[{}]},
  {participants:[{userId:'1'}]},{speech:[{userId:'1'}]},{avatarProfiles:[{kind:'unsupported'}]},
  {layoutMotion:{fromSeats:[]}},{camera:{...state.camera,to:{...state.camera.to,position:[0,0,null]}}},
 ];
 for(const changes of bad)expect(receiver.accept({...delta,changes})).toBeNull();
 expect(receiver.ready).toBe(true);
 const last=receiver.accept(delta)!;expect(last.serverNowMs).toBe(100);expect(last.studio).toBe(first!.studio);
 expect(receiver.accept({type:'snapshot',frame:3,state:{...state,seq:0}})).toBeNull();
});
