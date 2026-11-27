import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {PresetStore} from '../../src/presets/store.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {SettingsService} from '../../src/server/settings-service.ts';
import {SettingsStore} from '../../src/storage/settings-store.ts';
import {png} from '../helpers/png.ts';

async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-'));
  const settings=new SettingsStore(dir),initial=await settings.initialize();
  const studios=new StudioStore(dir),avatars=new AvatarStore(dir),presets=new PresetStore(dir);
  await Promise.all([studios.initialize(),avatars.initialize()]);
  const engine=new AppEngine({source:'demo',serverEpoch:'test',studio:initial.studio,avatarProfiles:initial.avatarProfiles});
  for(const event of demoEvents())engine.apply(event);engine.tick(3000);
  for(const session of engine.sessions())settings.saveSession('demo',session,settings.generation);
  const service=new SettingsService(engine,settings,studios,avatars,presets,()=>3500);
  return {dir,settings,studios,avatars,presets,engine,service,close:()=>rm(dir,{recursive:true,force:true})};
}

test('late camera planning failure leaves durable settings, revision, runtime and next startup unchanged',async()=>{
  const f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot(),tick=f.engine.tick.bind(f.engine);
  f.engine.tick=now=>{tick(now);throw Error('INJECTED_PLANNING_FAILURE');};
  try{
    await expect(f.service.scene({...before.studio,tableAnchor:{position:[1,0,0],yawDeg:0}},before.revision)).rejects.toThrow('INJECTED_PLANNING_FAILURE');
    expect(f.engine.snapshot()).toEqual(before);expect(f.settings.snapshot()).toEqual(saved);
    expect(await new SettingsStore(f.dir).initialize()).toEqual(saved);
  }finally{f.engine.tick=tick;await f.close();}
});
test('failed avatar layout preserves profiles, reservations and camera history without compensating writes',async()=>{
  const f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot(),tick=f.engine.tick.bind(f.engine);
  const image=await f.avatars.importImage(new Uint8Array(png()));
  f.engine.tick=now=>{tick(now);throw Error('INJECTED_LAYOUT_FAILURE');};
  try{
    await expect(f.service.avatar({userId:before.participants[0]!.userId,assetId:image.assetId,faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0},before.revision)).rejects.toThrow('INJECTED_LAYOUT_FAILURE');
    expect(f.engine.snapshot()).toEqual(before);expect(f.settings.snapshot()).toEqual(saved);
    expect(await new SettingsStore(f.dir).initialize()).toEqual(saved);
  }finally{f.engine.tick=tick;await f.close();}
});
test('channel changes during asynchronous validation survive a rejected settings operation',async()=>{
  const f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot(),validate=f.studios.validateDraft.bind(f.studios);
  f.studios.validateDraft=async input=>{
    const result=await validate(input);
    f.engine.apply({type:'snapshot',channel:{channelId:'999',name:'New VC',kind:'guild-voice'},participants:[],sourceGeneration:2,receivedAtMs:3400});
    return result;
  };
  try{
    await expect(f.service.scene({...before.studio,tableAnchor:{position:[1,0,0],yawDeg:0}},before.revision)).rejects.toThrow('SETTINGS_CONTEXT_CHANGED');
    expect(f.engine.snapshot().channel?.channelId).toBe('999');expect(f.engine.snapshot().revision).toBe(before.revision);
    expect(f.settings.snapshot()).toEqual(saved);expect(f.engine.snapshot().studio).toEqual(before.studio);
    expect(await new SettingsStore(f.dir).initialize()).toEqual(saved);
  }finally{await f.close();}
});
test('a failure after the settings SQL update rolls back settings, active seats and the whole domain',async()=>{
  const f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot(),preset=capturePreset(before,'dark');
  await f.presets.create('test',{...preset,autoCamera:false,studio:{...preset.studio,tableAnchor:{position:[1,0,0],yawDeg:0}}});
  const db=new Database(join(f.dir,'settings.sqlite'));
  db.run("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'INJECTED_SESSION_FAILURE'); END;");db.close(true);
  try{
    await expect(f.service.preset('test.json',before.revision)).rejects.toThrow('SETTINGS_WRITE_FAILED');
    expect(f.settings.snapshot()).toEqual(saved);expect(f.engine.snapshot()).toEqual(before);
    const reopened=new SettingsStore(f.dir);expect(await reopened.initialize()).toEqual(saved);
    expect(reopened.loadSessions('demo')).toEqual(f.settings.loadSessions('demo'));
  }finally{await f.close();}
});
test('preset application commits scene, profiles, preferences and current seats as one restartable generation',async()=>{
  const f=await fixture(),before=f.engine.snapshot();
  try{
    const image=await f.avatars.importImage(new Uint8Array(png()));
    const profile=await f.avatars.validateDraft({userId:before.participants[0]!.userId,assetId:image.assetId,faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0});
    const preset=capturePreset(before,'dark');preset.avatarProfiles=[profile];preset.autoCamera=false;
    preset.studio.tableAnchor={position:[1,0,0],yawDeg:20};
    await f.presets.create('all',preset);
    const result=await f.service.preset('all.json',before.revision),after=f.engine.snapshot();
    const reopened=new SettingsStore(f.dir),restored=await reopened.initialize();
    expect(restored.generation).toBe(1);expect(restored.studio).toEqual(after.studio);expect(restored.avatarProfiles).toEqual(after.avatarProfiles);
    expect(restored.preferences).toMatchObject({autoCamera:false,theme:'dark'});expect(reopened.loadSessions('demo')).toEqual(f.engine.sessions());
    expect(result.presetSignature).toBe(JSON.stringify(capturePreset(after,'dark')));
    const engine=new AppEngine({source:'demo',serverEpoch:'restart',studio:restored.studio,avatarProfiles:restored.avatarProfiles,sessions:reopened.loadSessions('demo'),seatingDefaults:restored.preferences!.seating,autoCamera:restored.preferences!.autoCamera});
    for(const event of demoEvents())engine.apply(event);engine.tick(3500);
    expect(engine.snapshot().studio).toEqual(after.studio);expect(engine.snapshot().mode).toBe('HOLD');
    expect(engine.snapshot().session.reservations).toEqual(after.session.reservations);
  }finally{await f.close();}
});
test('an independent process generation conflict restores engine planning and preserves the newer database',async()=>{
  const f=await fixture(),before=f.engine.snapshot(),saved=f.settings.snapshot();
  const other=new SettingsStore(f.dir);await other.initialize();other.commit({...other.snapshot(),studio:{...other.snapshot().studio,revision:1}});
  try{
    await expect(f.service.scene({...before.studio,tableAnchor:{position:[1,0,0],yawDeg:0}},before.revision)).rejects.toThrow('SETTINGS_CONFLICT');
    expect(f.engine.snapshot()).toEqual(before);expect(f.settings.snapshot()).toEqual(saved);
    expect(await new SettingsStore(f.dir).initialize()).toEqual(other.snapshot());
  }finally{await f.close();}
});
