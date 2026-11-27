import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SettingsStore,type SessionSource} from '../../src/storage/settings-store.ts';
import {SessionWriter} from '../../src/storage/session-writer.ts';
import {newSession} from '../../src/domain/seat-allocator.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoParticipant} from '../../src/replay/demo.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import type {SeatSession} from '../../src/contracts/domain.ts';

async function openStore(directory:string):Promise<SettingsStore>{
 const store=new SettingsStore(directory);await store.initialize();return store;
}
async function legacy(directory:string,source:SessionSource,session:SeatSession):Promise<string>{
 const root=join(directory,'sessions',source);await mkdir(root,{recursive:true});
 const path=join(root,`${session.channelId}.json`);await writeFile(path,JSON.stringify(session,null,3)+'\n');return path;
}
function deferred(){let resolve!:()=>void;const ready=new Promise<void>(done=>{resolve=done;});return {ready,resolve};}

test('SQLite imports legacy sessions once, preserves originals and isolates demo from IPC channels',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-session-import-'));
 try{
  const demo={...newSession('200','demo'),revision:2},ipc={...newSession('200','ipc'),revision:5};
  const [demoPath,ipcPath]=await Promise.all([legacy(directory,'demo',demo),legacy(directory,'ipc',ipc)]);
  const [demoOriginal,ipcOriginal]=await Promise.all([readFile(demoPath,'utf8'),readFile(ipcPath,'utf8')]);
  await writeFile(demoPath+'.bak','original backup');
  const store=await openStore(directory);
  expect(store.loadSessions('demo')).toEqual([demo]);expect(store.loadSessions('ipc')).toEqual([ipc]);
  expect(await readFile(demoPath,'utf8')).toBe(demoOriginal);expect(await readFile(ipcPath,'utf8')).toBe(ipcOriginal);
  expect(await readFile(demoPath+'.bak','utf8')).toBe('original backup');
  const newer={...demo,revision:3};expect(store.saveSession('demo',newer,store.generation)).toBe(true);
  await writeFile(demoPath,'{obsolete legacy file');
  const restored=await openStore(directory);
  expect(restored.loadSessions('demo')).toEqual([newer]);expect(restored.loadSessions('ipc')).toEqual([ipc]);
  expect(await readFile(demoPath,'utf8')).toBe('{obsolete legacy file');
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
});

test('one corrupt legacy source prevents partial migration and repairing the original permits a complete retry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-session-import-failure-'));
 try{
  const demo=newSession('200','demo'),ipc=newSession('201','ipc');
  const demoPath=await legacy(directory,'demo',demo),ipcPath=await legacy(directory,'ipc',ipc);
  const original=await readFile(demoPath,'utf8');await writeFile(ipcPath,'{broken');
  await expect(openStore(directory)).rejects.toThrow('SESSION_READ_FAILED');
  expect(await readFile(demoPath,'utf8')).toBe(original);expect(await readFile(ipcPath,'utf8')).toBe('{broken');
  expect(await Bun.file(join(directory,'settings.sqlite')).exists()).toBe(false);
  await writeFile(ipcPath,JSON.stringify(ipc));
  const restored=await openStore(directory);
  expect(restored.loadSessions('demo')).toEqual([demo]);expect(restored.loadSessions('ipc')).toEqual([ipc]);
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
});

test('a corrupt committed database never falls back to older session JSON',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-session-db-corrupt-'));
 try{
  const original=newSession('200','legacy'),path=await legacy(directory,'demo',original),store=await openStore(directory);
  store.saveSession('demo',{...original,revision:9},store.generation);
  const corrupted='not a SQLite database';await writeFile(join(directory,'settings.sqlite'),corrupted);
  await expect(openStore(directory)).rejects.toThrow('SETTINGS_READ_FAILED');
  expect(await readFile(join(directory,'settings.sqlite'),'utf8')).toBe(corrupted);
  expect(JSON.parse(await readFile(path,'utf8'))).toEqual(original);
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
});

test('a preset commits its active seats atomically, fences older queued saves and retains later seat moves after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-session-generation-'));
 const gate=deferred();let writer:SessionWriter|undefined;
 try{
  const store=await openStore(directory),engine=new AppEngine({source:'demo',serverEpoch:'first'});
  const participants=['1','2'].map(id=>({...demoParticipant(id),channelId:'200'}));
  engine.apply({type:'snapshot',channel:{channelId:'200',name:'room',kind:'guild-voice'},participants,sourceGeneration:1,receivedAtMs:0});
  engine.apply({type:'connection',status:'ready',sourceGeneration:1,receivedAtMs:1});engine.tick(2000);
  const initial=engine.sessions();for(const session of initial)store.saveSession('demo',session,store.generation);
  const entered=deferred(),writes:Array<{generation:number;accepted:boolean}>=[];
  writer=new SessionWriter(async(session,generation)=>{
   if(generation===0){entered.resolve();await gate.ready;}
   const accepted=store.saveSession('demo',session,generation);writes.push({generation,accepted});return accepted;
  },{sessions:initial,generation:store.generation});
  engine.control({type:'seat-move',userId:'1',slotIndex:2},engine.currentRevision,2100);
  const old=engine.snapshot().session;writer.offer(engine.sessions(),store.generation);await entered.ready;
  const preset=capturePreset(engine.snapshot(),'dark');preset.autoCamera=false;
  preset.studio.tableAnchor={position:[1,0,0],yawDeg:0};
  preset.seating.assignments=[{userId:'1',slotIndex:1},{userId:'2',slotIndex:0}];
  engine.applyPreset(preset,engine.currentRevision,3000,()=>{
   const state=engine.snapshot();
   store.commit({studio:state.studio,avatarProfiles:state.avatarProfiles,preferences:{seating:preset.seating,autoCamera:preset.autoCamera,theme:preset.theme}},{source:'demo',session:state.session});
  });
  const committed=engine.snapshot().session;expect(committed.sessionId).not.toBe(old.sessionId);expect(store.generation).toBe(1);
  // Reopening before the ordinary writer can run must already see the whole preset.
  const atCommit=await openStore(directory);
  expect(atCommit.snapshot().studio.tableAnchor).toEqual(preset.studio.tableAnchor);
  expect(atCommit.snapshot().preferences?.autoCamera).toBe(false);expect(atCommit.loadSessions('demo')).toEqual([committed]);
  writer.offer(engine.sessions(),store.generation);gate.resolve();await writer.flush();
  expect(writes).toEqual([{generation:0,accepted:false},{generation:1,accepted:true}]);
  expect((await openStore(directory)).loadSessions('demo')).toEqual([committed]);
  engine.control({type:'seat-move',userId:'1',slotIndex:3},engine.currentRevision,4000);
  const moved=engine.snapshot().session;writer.offer(engine.sessions(),store.generation);await writer.flush();
  const restarted=await openStore(directory),settings=restarted.snapshot();expect(restarted.loadSessions('demo')).toEqual([moved]);
  const restoredEngine=new AppEngine({source:'demo',serverEpoch:'second',sessions:restarted.loadSessions('demo'),studio:settings.studio,avatarProfiles:settings.avatarProfiles,seatingDefaults:settings.preferences?.seating,autoCamera:settings.preferences?.autoCamera});
  restoredEngine.apply({type:'snapshot',channel:{channelId:'200',name:'room',kind:'guild-voice'},participants,sourceGeneration:1,receivedAtMs:0});
  expect(restoredEngine.snapshot().session.reservations).toEqual(moved.reservations);
  expect(restoredEngine.snapshot().session.reservations.find(person=>person.userId==='1')?.slotIndex).toBe(3);
  expect(restoredEngine.snapshot().studio.tableAnchor).toEqual(preset.studio.tableAnchor);expect(restoredEngine.snapshot().mode).toBe('HOLD');
 }finally{gate.resolve();await writer?.flush().catch(()=>{});await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
