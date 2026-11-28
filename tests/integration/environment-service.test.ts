import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents,demoParticipant} from '../../src/replay/demo.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {SettingsStore} from '../../src/storage/settings-store.ts';
import {defaultSettings,presetPreferences,validateSettings} from '../../src/storage/settings-schema.ts';
import {capturePreset,type ParameterPreset} from '../../src/presets/schema.ts';
import {AvatarCache} from '../../src/server/avatar-cache.ts';
import {EnvironmentService} from '../../src/server/environment-service.ts';
import {inspectEnvironmentPackage} from '../../src/environment/package.ts';
import {createEnvironmentPreview} from '../../src/environment/preview.ts';
import {png} from '../helpers/png.ts';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const iconUrl='https://cdn.discordapp.com/avatars/100/current.png?size=256';
const json=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));

async function fixture(people?:string[]){
  const dir=await mkdtemp(join(tmpdir(),'entaku-environment-'));
  const settings=new SettingsStore(dir),initial=await settings.initialize();
  const studios=new StudioStore(dir),avatars=new AvatarStore(dir),avatarCache=new AvatarCache();
  await Promise.all([studios.initialize(),avatars.initialize()]);
  avatarCache.get=async()=>{throw new Error('UNEXPECTED_NETWORK');};
  const engine=new AppEngine({source:'demo',serverEpoch:'live',studio:initial.studio,avatarProfiles:initial.avatarProfiles});
  for(const event of demoEvents())engine.apply(event);
  if(people)engine.apply({type:'snapshot',channel:{channelId:'201',name:'Receiving VC',kind:'guild-voice'},
    participants:people.map(userId=>({...demoParticipant(userId),channelId:'201'})),sourceGeneration:2,receivedAtMs:100});
  engine.tick(3000);
  for(const session of engine.sessions())settings.saveSession('demo',session,settings.generation);
  const service=new EnvironmentService(engine,settings,studios,avatars,avatarCache,()=>3500);
  return {dir,settings,studios,avatars,avatarCache,engine,service,close:()=>rm(dir,{recursive:true,force:true})};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const version=(f:Fixture)=>({expectedRevision:f.engine.currentRevision,expectedGeneration:f.settings.generation});
async function approved(f:Fixture,bytes:Uint8Array){
  const inspection=await f.service.inspect(bytes);
  return {sha256:inspection.summary.sha256,expectedRevision:inspection.revision,expectedGeneration:inspection.generation};
}
function install(f:Fixture,preset:ParameterPreset){
  f.engine.applyPreset(preset,f.engine.currentRevision,3100,()=>{
    const state=f.engine.snapshot();
    f.settings.commit({...f.settings.snapshot(),studio:state.studio,avatarProfiles:state.avatarProfiles,preferences:presetPreferences(preset)},
      {source:'demo',session:state.session});
  });
}
async function imagePackage(){
  const f=await fixture();
  try{
    const image=await f.avatars.importImage(png());
    const preset=capturePreset(f.engine.snapshot(),'dark');
    preset.avatarProfiles=[await f.avatars.validateDraft({userId:'100',assetId:image.assetId,faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0})];
    preset.studio.tableAnchor={position:[1,0,0],yawDeg:15};
    install(f,preset);
    return await f.service.export({...version(f),theme:'dark'});
  }finally{await f.close();}
}

test('schema-1 settings without a saved environment remain compatible; malformed rosters do not',()=>{
  const original={...defaultSettings(),schemaVersion:1,generation:0};delete original.environment;
  expect(validateSettings(original).environment).toBeNull();
  expect(createEnvironmentPreview(validateSettings(original))).toBeNull();
  expect(()=>validateSettings({...original,environment:{identities:[],presentUserIds:['100']}})).toThrow('ENVIRONMENT_PEOPLE_INVALID');
});

test('one package restores stage dependencies, portraits, bindings and all active settings without replacing live people',async()=>{
  const source=await fixture(),target=await fixture(['900']);
  try{
    const front=await source.avatars.importImage(png()),back=await source.avatars.importImage(png(80,128));
    const bundle=await source.studios.importFiles([
      {path:'models/room.gltf',bytes:json({asset:{version:'2.0'},buffers:[{uri:'../shared/mesh.bin',byteLength:12}]})},
      {path:'shared/mesh.bin',bytes:new Uint8Array(12)},
    ]);
    const preset=capturePreset(source.engine.snapshot(),'dark');
    preset.avatarProfiles=[await source.avatars.validateDraft({userId:'101',assetId:front.assetId,faceRect:[.25,.1,.5,.25],scale:1,offsetX:.05,offsetY:.1,
      back:{assetId:back.assetId,faceRect:[.2,.1,.5,.25]}})];
    preset.studio.objects.push({id:'room',kind:'model',bundleId:bundle.bundleId,speakerUserId:'777',transform:{position:[0,0,-2],yawDeg:10,scale:[1,1,1]}});
    preset.studio.tableAnchor={position:[.3,0,-.2],yawDeg:12};
    preset.studio.quality!.renderScale=1.5;preset.studio.quality!.aoStrength=1.2;
    preset.studio.exposure={mode:'manual',manualExposure:.8,compensationEV:1,lighting:'combined'};
    preset.studio.post!.bloom=true;preset.studio.post!.bloomStrength=.3;
    preset.studio.direction!.splitEnabled=false;preset.studio.gaussian={lodSplatCount:250000};
    preset.studio.broadcast={enabled:true,title:'持ち運ぶ番組',subtitle:'SETUP'};
    preset.autoCamera=false;
    [preset.seating.assignments[0]!.slotIndex,preset.seating.assignments[1]!.slotIndex]=[preset.seating.assignments[1]!.slotIndex,preset.seating.assignments[0]!.slotIndex];
    install(source,preset);
    source.settings.commit({...source.settings.snapshot(),misskey:{...source.settings.snapshot().misskey,enabled:true,maxCards:12,maxPerUser:2,blockedWords:['設定した語'],blockedUsers:['blocked-user']}});
    const speaking={...source.engine.participant('100')!,avatarUrl:iconUrl,voice:{selfMute:true,selfDeaf:false,serverMute:false,serverDeaf:false}};
    source.engine.apply({type:'participant-upsert',participant:speaking,sourceGeneration:1,receivedAtMs:3200});
    source.engine.apply({type:'speaking',userId:'100',state:'active',sourceGeneration:1,receivedAtMs:3200});
    const icon=png(256,256);source.avatarCache.get=async url=>{expect(url).toBe(iconUrl);return icon;};
    const saved=source.settings.snapshot(),expected=capturePreset(source.engine.snapshot(),'dark');
    const bytes=await source.service.export({...version(source),theme:'dark'});
    expect(source.settings.snapshot()).toEqual(saved);
    await expect(source.avatars.get(hash(icon))).rejects.toThrow();
    const inspected=await inspectEnvironmentPackage(bytes);
    expect(inspected.content.manifest.people.identities.some(p=>p.userId==='777')).toBe(false);
    expect(inspected.content.manifest.preset.studio.objects[0]).toMatchObject({speakerUserId:'777'});
    const before=target.engine.snapshot();
    const result=await target.service.import(bytes,await approved(target,bytes));
    expect(result).toMatchObject({theme:'dark',generation:1,previewAvailable:true});
    expect(target.engine.snapshot().participants).toEqual(before.participants);
    expect(target.engine.snapshot().channel).toEqual(before.channel);
    expect(target.service.decorate(target.engine.snapshot()).participants[0]!.iconAssetId).toBeUndefined();
    expect((await target.avatars.get(front.assetId)).bytes).toEqual(png());
    expect((await target.avatars.get(back.assetId)).bytes).toEqual(png(80,128));
    expect((await target.avatars.get(hash(icon))).bytes).toEqual(icon);
    expect((await target.studios.file(bundle.bundleId,'shared/mesh.bin')).bytes).toEqual(new Uint8Array(12));
    const restored=new SettingsStore(target.dir),settings=await restored.initialize();
    expect(settings.studio).toEqual({...expected.studio,revision:1});
    expect(settings.avatarProfiles).toEqual(expected.avatarProfiles);
    expect(settings.preferences).toEqual(presetPreferences(expected));
    expect(settings.misskey).toEqual(saved.misskey);
    expect(restored.loadSessions('demo')).toEqual(target.engine.sessions());
    const preview=createEnvironmentPreview(settings,4000)!.snapshot();
    expect(preview.participants.map(p=>p.userId)).toEqual(['100','101','102','103','104','105']);
    expect(preview.participants.find(p=>p.userId==='100')).toMatchObject({iconAssetId:hash(icon),speaking:'unknown',voice:{selfMute:false,selfDeaf:false,serverMute:false,serverDeaf:false}});
    expect(preview.avatarProfiles).toHaveLength(1);
    expect(preview.mode).toBe('HOLD');
    expect(capturePreset(preview,'dark')).toEqual(expected);
  }finally{await Promise.all([source.close(),target.close()]);}
});

test('export takes current Discord portraits and their deletion; saved icons are only an offline fallback',async()=>{
  const f=await fixture();
  try{
    const old=await f.avatars.importImage(png(32,32)),fresh=png(64,64);
    f.settings.commit({...f.settings.snapshot(),environment:{identities:[{userId:'100',username:'saved',displayName:'保存時',iconAssetId:old.assetId}],presentUserIds:['100']}});
    const participant=f.engine.participant('100')!;
    f.engine.apply({type:'participant-upsert',participant:{...participant,avatarUrl:iconUrl},sourceGeneration:1,receivedAtMs:3100});
    let calls=0;f.avatarCache.get=async()=>{calls++;return fresh;};
    const current=await inspectEnvironmentPackage(await f.service.export({...version(f),theme:'light'}));
    expect(current.content.manifest.people.identities.find(p=>p.userId==='100')!.iconAssetId).toBe(hash(fresh));
    expect(calls).toBe(1);
    f.engine.apply({type:'participant-upsert',participant,sourceGeneration:1,receivedAtMs:3200});
    const removed=await inspectEnvironmentPackage(await f.service.export({...version(f),theme:'light'}));
    expect(removed.content.manifest.people.identities.find(p=>p.userId==='100')!.iconAssetId).toBeUndefined();
    expect(calls).toBe(1);
    f.engine.apply({type:'snapshot',channel:null,participants:[],sourceGeneration:2,receivedAtMs:3300});
    const offline=await inspectEnvironmentPackage(await f.service.export({...version(f),theme:'light'}));
    expect(offline.content.manifest.people).toEqual(f.settings.snapshot().environment!);
    expect(calls).toBe(1);
  }finally{await f.close();}
});

test('a missing Discord portrait fails export explicitly without changing settings or substituting a saved icon',async()=>{
  const f=await fixture(),before=f.settings.snapshot();
  try{
    f.engine.apply({type:'participant-upsert',participant:{...f.engine.participant('100')!,avatarUrl:iconUrl},sourceGeneration:1,receivedAtMs:3100});
    await expect(f.service.export({...version(f),theme:'system'})).rejects.toThrow('ENVIRONMENT_ICON_UNAVAILABLE');
    expect(f.settings.snapshot()).toEqual(before);
  }finally{await f.close();}
});

test('an offline restart re-exports saved seating and appearances before its first voice snapshot',async()=>{
  const bytes=await imagePackage(),f=await fixture();
  try{
    await f.service.import(bytes,await approved(f,bytes));
    const settings=new SettingsStore(f.dir),saved=await settings.initialize();
    const engine=new AppEngine({source:'ipc',serverEpoch:'restart',studio:saved.studio,avatarProfiles:saved.avatarProfiles,
      seatingDefaults:saved.preferences!.seating,autoCamera:saved.preferences!.autoCamera});
    const service=new EnvironmentService(engine,settings,f.studios,f.avatars,f.avatarCache,()=>3500);
    const exported=await inspectEnvironmentPackage(await service.export({expectedRevision:0,expectedGeneration:saved.generation,theme:'dark'}));
    expect(exported.content.manifest.preset.seating).toEqual(saved.preferences!.seating);
    expect(exported.content.manifest.people).toEqual(saved.environment!);
    expect(engine.snapshot().participants).toEqual([]);
  }finally{await f.close();}
});

test('import requires the inspected archive and rejects a channel changed after review',async()=>{
  const bytes=await imagePackage(),f=await fixture();
  try{
    await expect(f.service.import(bytes,{...version(f),sha256:hash(bytes)})).rejects.toThrow('ENVIRONMENT_INSPECTION_REQUIRED');
    const request=await approved(f,bytes),tampered=bytes.slice();tampered[tampered.length-1]=tampered[tampered.length-1]!^1;
    await expect(f.service.import(tampered,request)).rejects.toThrow('ENVIRONMENT_PACKAGE_CHANGED');
    const saved=f.settings.snapshot();
    f.engine.apply({type:'snapshot',channel:{channelId:'999',name:'New VC',kind:'guild-voice'},participants:[],sourceGeneration:2,receivedAtMs:3400});
    await expect(f.service.import(bytes,request)).rejects.toThrow('ENVIRONMENT_CONTEXT_CHANGED');
    expect(f.settings.snapshot()).toEqual(saved);expect(f.engine.snapshot().channel!.channelId).toBe('999');
  }finally{await f.close();}
});

for(const change of ['context','revision','generation'] as const)test(`a ${change} change during asset publication rejects the import without restoring old runtime state`,async()=>{
  const bytes=await imagePackage(),f=await fixture(),before=f.settings.snapshot();
  try{
    const request=await approved(f,bytes),original=f.avatars.importImage.bind(f.avatars);let changed=false;
    f.avatars.importImage=async input=>{
      const value=await original(input);
      if(!changed){
        changed=true;
        if(change==='context')f.engine.apply({type:'snapshot',channel:{channelId:'999',name:'New VC',kind:'guild-voice'},participants:[],sourceGeneration:2,receivedAtMs:3400});
        if(change==='revision')f.engine.setStudioScene({...f.engine.snapshot().studio,tableAnchor:{position:[2,0,0],yawDeg:0}},f.engine.currentRevision,3400);
        if(change==='generation')f.settings.commit({...f.settings.snapshot(),misskey:{...f.settings.snapshot().misskey,hashtag:'ChangedDuringImport'}});
      }
      return value;
    };
    await expect(f.service.import(bytes,request)).rejects.toThrow(change==='context'?'ENVIRONMENT_CONTEXT_CHANGED':change==='revision'?'REVISION_CONFLICT':'SETTINGS_CONFLICT');
    expect(changed).toBe(true);
    if(change==='context')expect(f.engine.snapshot().channel!.channelId).toBe('999');
    if(change==='revision')expect(f.engine.snapshot().studio.tableAnchor.position).toEqual([2,0,0]);
    if(change==='generation')expect(f.settings.snapshot().misskey.hashtag).toBe('ChangedDuringImport');
    else expect(f.settings.snapshot()).toEqual(before);
    expect(f.settings.snapshot().environment).toBeNull();
  }finally{await f.close();}
});

test('a SQL failure after settings update rolls back scene, seats, preview roster and engine together',async()=>{
  const bytes=await imagePackage(),f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot();
  try{
    const request=await approved(f,bytes),db=new Database(join(f.dir,'settings.sqlite'));
    db.run("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'INJECTED_SESSION_FAILURE'); END;");db.close(true);
    await expect(f.service.import(bytes,request)).rejects.toThrow('SETTINGS_WRITE_FAILED');
    expect(f.engine.snapshot()).toEqual(before);expect(f.settings.snapshot()).toEqual(saved);
    const reopened=new SettingsStore(f.dir);expect(await reopened.initialize()).toEqual(saved);
    expect(reopened.loadSessions('demo')).toEqual(f.engine.sessions());
    expect(f.service.previewSnapshot()).toBeNull();
  }finally{await f.close();}
});

test('an independent process generation conflict preserves newer storage and rolls back import planning',async()=>{
  const bytes=await imagePackage(),f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot();
  try{
    const request=await approved(f,bytes),other=new SettingsStore(f.dir);await other.initialize();
    other.commit({...other.snapshot(),misskey:{...other.snapshot().misskey,hashtag:'OtherProcess'}});
    await expect(f.service.import(bytes,request)).rejects.toThrow('SETTINGS_CONFLICT');
    expect(f.engine.snapshot()).toEqual(before);expect(f.settings.snapshot()).toEqual(saved);
    expect(await new SettingsStore(f.dir).initialize()).toEqual(other.snapshot());
  }finally{await f.close();}
});

test('preview identity and icons stay isolated, and repeated broadcast reads reuse the generation cache',async()=>{
  const f=await fixture();
  try{
    const icon=await f.avatars.importImage(png(32,32));
    f.settings.commit({...f.settings.snapshot(),preferences:presetPreferences(capturePreset(f.engine.snapshot(),'system')),
      environment:{identities:[{userId:'100',username:'saved',displayName:'保存時',iconAssetId:icon.assetId}],presentUserIds:['100']}});
    const live=f.engine.snapshot(),read=f.settings.snapshot.bind(f.settings);let reads=0;
    f.settings.snapshot=()=>{reads++;return read();};
    const first=f.service.previewSnapshot(3500)!;
    for(let i=0;i<20;i++)f.service.previewSnapshot(3500+i*100);
    expect(reads).toBe(1);expect(f.engine.snapshot()).toEqual(live);
    expect(first.participants[0]).toMatchObject({displayName:'保存時',iconAssetId:icon.assetId});
    expect(f.service.decorate(live)).toBe(live);
    f.settings.commit({...read(),misskey:{...read().misskey,hashtag:'NextGeneration'}});
    expect(f.service.previewSnapshot(6000)!.serverEpoch).not.toBe(first.serverEpoch);
    expect(reads).toBe(2);
  }finally{await f.close();}
});
