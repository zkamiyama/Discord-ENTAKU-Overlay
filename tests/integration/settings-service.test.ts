import {expect,test} from 'bun:test';
import {mkdtemp,readFile,readdir,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {StudioStore} from '../../src/studio/store.ts';
import {AvatarStore} from '../../src/assets/store.ts';
import {PresetStore} from '../../src/presets/store.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {SettingsService} from '../../src/server/settings-service.ts';
import {writeAtomicJson} from '../../src/storage/atomic-json.ts';
import {png} from '../helpers/png.ts';

async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-'));
  const studios=new StudioStore(dir),avatars=new AvatarStore(dir),presets=new PresetStore(dir);
  await studios.initialize();await avatars.initialize();
  const engine=new AppEngine({source:'demo',serverEpoch:'test',studio:studios.snapshot()});
  for(const event of demoEvents())engine.apply(event);engine.tick(3000);
  const service=new SettingsService(engine,studios,avatars,presets,()=>3500);
  return {dir,studios,avatars,presets,engine,service,close:()=>rm(dir,{recursive:true,force:true})};
}
test('late camera planning failure restores disk scene, revision, runtime and next startup',async()=>{
  const f=await fixture();const before=f.engine.snapshot(),tick=f.engine.tick.bind(f.engine);
  f.engine.tick=now=>{tick(now);throw Error('INJECTED_PLANNING_FAILURE');};
  try{
    await expect(f.service.scene({...before.studio,tableAnchor:{position:[1,0,0],yawDeg:0}},before.revision)).rejects.toThrow('INJECTED_PLANNING_FAILURE');
    expect(f.engine.snapshot()).toEqual(before);expect(f.studios.snapshot()).toEqual(before.studio);
    expect(JSON.parse(await readFile(join(f.dir,'scene.json'),'utf8'))).toEqual(before.studio);
    expect(await new StudioStore(f.dir).initialize()).toEqual(before.studio);
  }finally{f.engine.tick=tick;await f.close();}
});
test('failed avatar layout restores profiles, reservations and camera history',async()=>{
  const f=await fixture();const before=f.engine.snapshot(),tick=f.engine.tick.bind(f.engine);
  const image=await f.avatars.importImage(new Uint8Array(png()));
  f.engine.tick=now=>{tick(now);throw Error('INJECTED_LAYOUT_FAILURE');};
  try{
    await expect(f.service.avatar({userId:before.participants[0]!.userId,assetId:image.assetId,faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0},before.revision)).rejects.toThrow('INJECTED_LAYOUT_FAILURE');
    expect(f.engine.snapshot()).toEqual(before);expect(f.avatars.snapshot()).toEqual([]);
    expect(await new AvatarStore(f.dir).initialize()).toEqual([]);
  }finally{f.engine.tick=tick;await f.close();}
});
test('channel changes during filesystem writes are retained while the setting is rolled back',async()=>{
  const f=await fixture();const before=f.engine.snapshot(),save=f.studios.save.bind(f.studios);
  f.studios.save=async input=>{
    const result=await save(input);
    f.engine.apply({type:'snapshot',channel:{channelId:'999',name:'New VC',kind:'guild-voice'},participants:[],sourceGeneration:2,receivedAtMs:3400});
    return result;
  };
  try{
    await expect(f.service.scene({...before.studio,tableAnchor:{position:[1,0,0],yawDeg:0}},before.revision)).rejects.toThrow('SETTINGS_CONTEXT_CHANGED');
    expect(f.engine.snapshot().channel?.channelId).toBe('999');expect(f.engine.snapshot().revision).toBe(before.revision);
    expect(f.studios.snapshot()).toEqual(before.studio);expect(f.engine.snapshot().studio).toEqual(before.studio);
  }finally{await f.close();}
});
test('preset compensation attempts every completed store even if one undo fails',async()=>{
  const f=await fixture(),before=f.engine.snapshot(),preset=capturePreset(before,'dark');
  await f.presets.preferences(preset);await f.presets.create('test',{...preset,autoCamera:false});
  const save=f.avatars.saveProfiles.bind(f.avatars),tick=f.engine.tick.bind(f.engine);let writes=0;
  f.avatars.saveProfiles=async p=>{if(++writes===2)throw Error('INJECTED_UNDO_FAILURE');await save(p);};
  f.engine.tick=()=>{throw Error('INJECTED_PLANNING_FAILURE');};
  try{
    await expect(f.service.preset('test.json',before.revision)).rejects.toThrow('PRESET_ROLLBACK_FAILED');
    expect(writes).toBe(2);expect(f.studios.snapshot()).toEqual(before.studio);expect(await f.presets.preferences()).toEqual(preset);
    expect(f.engine.snapshot()).toEqual(before);
  }finally{f.engine.tick=tick;await f.close();}
});
test('atomic JSON replacement preserves a backup and removes temporary files on failure',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-json-')),file=join(dir,'settings.json');
  try{
    await writeAtomicJson(file,{version:1},'WRITE_FAILED');await writeAtomicJson(file,{version:2},'WRITE_FAILED',true);
    expect(JSON.parse(await readFile(file,'utf8'))).toEqual({version:2});expect(JSON.parse(await readFile(file+'.bak','utf8'))).toEqual({version:1});
    const bad=join(dir,'directory');await mkdir(bad);await expect(writeAtomicJson(bad,{x:1},'WRITE_FAILED')).rejects.toThrow('WRITE_FAILED');
    expect((await readdir(dir)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
