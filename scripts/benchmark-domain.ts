import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Participant,ProviderEvent} from '../src/contracts/domain.ts';
/** Synthetic inputs only. Run against another checkout with --root PATH to
 * compare identical workloads; timings are CPU/wall time, not GPU or OBS FPS. */
const root=resolve(process.argv[process.argv.indexOf('--root')+1]&&process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]!:'.');
const {AppEngine}=await import(pathToFileURL(resolve(root,'src/domain/engine.ts')).href) as typeof import('../src/domain/engine.ts');
const percentile=(values:number[],q:number)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*q)]!;
const runs=[];
for(const count of [6,16,32]){
 const engine=new AppEngine({source:'demo',serverEpoch:'synthetic-benchmark',utcNow:()=>new Date(0).toISOString(),sessionId:()=> 'bench'});
 const participants:Participant[]=Array.from({length:count},(_,i)=>({userId:String(i+1),channelId:'200',username:'synthetic',displayName:'Synthetic '+i,presence:'present',speaking:'inactive',voice:{selfMute:false,selfDeaf:false,serverMute:false,serverDeaf:false}}));
 engine.apply({type:'snapshot',channel:{channelId:'200',name:'Synthetic',kind:'guild-voice'},participants,sourceGeneration:1,receivedAtMs:0});
 engine.apply({type:'connection',status:'ready',sourceGeneration:1,receivedAtMs:0});
 const tick:number[]=[],snapshot:number[]=[],encode:number[]=[];let bytes=0;
 for(let i=0;i<1200;i++){
  const now=3000+i*50;
  if(i%100===0)for(let j=0;j<3;j++)engine.apply({type:'speaking',userId:String(j+2),state:(Math.floor(i/100)+j)%3?'active':'inactive',sourceGeneration:1,receivedAtMs:now} as ProviderEvent);
  const t=performance.now();engine.tick(now);const t1=performance.now();const state=engine.snapshot(now);const t2=performance.now();const encoded=JSON.stringify(state);const t3=performance.now();
  if(i>=200){tick.push(t1-t);snapshot.push(t2-t1);encode.push(t3-t2);bytes+=Buffer.byteLength(encoded);}
 }
 const summarize=(values:number[])=>({p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)});
 runs.push({participants:count,samples:tick.length,tick:summarize(tick),snapshot:summarize(snapshot),encode:summarize(encode),averageSnapshotBytes:Math.round(bytes/tick.length)});
}
const commit=Bun.spawnSync(['git','-C',root,'rev-parse','HEAD']);
const dirty=Bun.spawnSync(['git','-C',root,'status','--porcelain']).stdout.toString().trim().length>0;
console.log(JSON.stringify({kind:'synthetic-domain-cpu',commit:commit.stdout.toString().trim(),dirty,runtime:Bun.version,platform:process.platform,arch:process.arch,runs},null,2));
