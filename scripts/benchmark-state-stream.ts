import assert from 'node:assert/strict';
import {StatePublisher,StateReceiver} from '../src/contracts/state-stream.ts';
import {AppEngine} from '../src/domain/engine.ts';
import {demoParticipant} from '../src/replay/demo.ts';
import type {GaussianAvatarProfile} from '../src/assets/gaussian-profile.ts';

const engine=new AppEngine({source:'demo',serverEpoch:'benchmark',utcNow:()=>new Date(0).toISOString(),sessionId:()=> 'bench'});
const ids=Array.from({length:32},(_,i)=>String(i+100));
const people=ids.map(id=>({...demoParticipant(id),channelId:'200'}));
engine.apply({type:'connection',status:'ready',sourceGeneration:1,receivedAtMs:0});
engine.apply({type:'snapshot',channel:{channelId:'200',name:'Benchmark',kind:'guild-voice'},participants:people,sourceGeneration:1,receivedAtMs:0});
const seed=engine.snapshot();
seed.studio={...seed.studio,objects:ids.map((_,i)=>({id:'model'+i,kind:'model',bundleId:'a'.repeat(64),transform:{position:[i,0,0],yawDeg:0,scale:[1,1,1]}}))};
seed.avatarProfiles=ids.map((userId):GaussianAvatarProfile=>({kind:'gaussian',userId,assetId:'b'.repeat(64),scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0,
 manifest:{schemaVersion:1,kind:'entaku-gaussian-avatar',name:'fixture',splat:'model.ply',coordinates:{units:'m',up:'+Y',forward:'+Z'},normalization:{scale:1,rotation:[0,0,0],translation:[0,0,0]},faceAnchor:[0,1,0],faceBounds:{min:[-.1,.8,-.1],max:[.1,1.2,.1]},bodyBounds:{min:[-.3,0,-.3],max:[.3,1.8,.3]},framingBounds:{min:[-.3,0,-.3],max:[.3,1.8,.3]}}}));
const sender=new StatePublisher(),receiver=new StateReceiver();
let fullBytes=0,wireBytes=0;const count=10_000,started=performance.now();
for(let i=0;i<count;i++){
 const state={...seed,seq:i,serverNowMs:i*100,speech:seed.speech.map((s,j)=>j===0?{...s,activeMs:i*100,ratio:1,qualified:true}:s)};
 const frame=sender.publish(state),wire=frame.delta??frame.full();
 fullBytes+=Buffer.byteLength(frame.full());wireBytes+=Buffer.byteLength(wire);
 assert.deepEqual(receiver.accept(JSON.parse(wire)),JSON.parse(JSON.stringify(state)));
}
console.log(JSON.stringify({frames:count,participants:ids.length,models:seed.studio.objects.length,fullBytes,wireBytes,reductionPercent:100*(1-wireBytes/fullBytes),validationElapsedMs:Math.round(performance.now()-started),scope:'synthetic wire payload; no WebSocket compression, GPU or OBS performance claim'},null,2));
