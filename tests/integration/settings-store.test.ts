import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SettingsStore} from '../../src/storage/settings-store.ts';
import {presetPreferences} from '../../src/storage/settings-schema.ts';
import {DEFAULT_STUDIO_SCENE,type StudioScene} from '../../src/studio/manifest.ts';
import type {ImageAvatarProfile} from '../../src/assets/avatar-profile.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {newSession} from '../../src/domain/seat-allocator.ts';

async function opened(directory:string):Promise<SettingsStore>{const store=new SettingsStore(directory);await store.initialize();return store;}

test('three legacy settings files import once, retain original bytes and become one authoritative document',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-import-'));
  try{
    const studio:StudioScene={...structuredClone(DEFAULT_STUDIO_SCENE),revision:7,tableAnchor:{position:[1,0,2],yawDeg:20}};
    const profile:ImageAvatarProfile={userId:'1',assetId:'a'.repeat(64),image:{width:64,height:128,mime:'image/png'},faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0};
    const preset=capturePreset(new AppEngine({source:'demo',serverEpoch:'import'}).snapshot(),'dark');preset.autoCamera=false;
    const originals=new Map([['scene.json',JSON.stringify(studio,null,3)],['avatars.json',JSON.stringify({schemaVersion:2,profiles:[profile]},null,3)],['preset-state.json',JSON.stringify(preset,null,3)]]);
    for(const [name,text] of originals)await writeFile(join(dir,name),text);
    const store=await opened(dir),first=store.snapshot();
    expect(first.studio).toEqual(studio);expect(first.avatarProfiles).toEqual([profile]);expect(first.preferences).toEqual(presetPreferences(preset));
    for(const [name,text] of originals)expect(await readFile(join(dir,name),'utf8')).toBe(text);
    store.commit({...first,studio:{...first.studio,revision:8},preferences:null});
    for(const name of originals.keys())await writeFile(join(dir,name),'{obsolete legacy content');
    expect((await opened(dir)).snapshot()).toEqual(store.snapshot());
    expect((await readdir(dir)).filter(name=>name.startsWith('.settings-'))).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('an invalid migration source leaves every original intact and never publishes a partial database',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-invalid-'));
  try{
    const scene=JSON.stringify(DEFAULT_STUDIO_SCENE);await writeFile(join(dir,'scene.json'),scene);await writeFile(join(dir,'avatars.json'),'{broken');
    await expect(opened(dir)).rejects.toThrow('AVATAR_SETTINGS_READ_FAILED');
    expect(await readFile(join(dir,'scene.json'),'utf8')).toBe(scene);expect(await readFile(join(dir,'avatars.json'),'utf8')).toBe('{broken');
    expect(await Bun.file(join(dir,'settings.sqlite')).exists()).toBe(false);
    await writeFile(join(dir,'avatars.json'),JSON.stringify({schemaVersion:1,profiles:[]}));
    expect((await opened(dir)).snapshot().studio).toEqual(DEFAULT_STUDIO_SCENE);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('a truncated or unknown-schema canonical database cannot silently revive legacy settings',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-truncated-'));
  try{
    await writeFile(join(dir,'scene.json'),JSON.stringify(DEFAULT_STUDIO_SCENE));
    const store=await opened(dir);store.commit({...store.snapshot(),studio:{...store.snapshot().studio,revision:9}});
    const file=join(dir,'settings.sqlite');await writeFile(file,new Uint8Array());
    await expect(opened(dir)).rejects.toThrow('SETTINGS_SCHEMA_UNSUPPORTED');
    expect((await readFile(file)).length).toBe(0);
    const db=new Database(file);db.run('PRAGMA user_version=99;');db.close(true);
    await expect(opened(dir)).rejects.toThrow('SETTINGS_SCHEMA_UNSUPPORTED');
    const verify=new Database(file);expect(verify.query('PRAGMA user_version').get()).toEqual({user_version:99});verify.close(true);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('concurrent first imports publish a complete database once and release all handles',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-publish-'));
  try{
    const [a,b]=await Promise.all([opened(dir),opened(dir)]);expect(a.snapshot()).toEqual(b.snapshot());
    expect((await readdir(dir)).filter(name=>name.startsWith('.settings-'))).toEqual([]);
    const detached=a.snapshot();detached.studio.revision=77;expect(a.snapshot().studio.revision).not.toBe(77);
    a.commit({...a.snapshot(),studio:{...a.snapshot().studio,revision:1}});
    expect(()=>b.commit({...b.snapshot(),studio:{...b.snapshot().studio,revision:2}})).toThrow('SETTINGS_CONFLICT');
    const file=join(dir,'settings.sqlite'),moved=join(dir,'closed.sqlite');
    await rename(file,moved);await rename(moved,file);
    expect((await opened(dir)).snapshot()).toEqual(a.snapshot());
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('row versions reject another process changing seats without advancing the settings generation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-row-cas-'));
  try{
    const a=await opened(dir),initial=newSession('200','first');a.saveSession('demo',initial,a.generation);
    const b=await opened(dir);expect(b.loadSessions('demo')).toEqual([initial]);
    const newer={...initial,revision:1};a.saveSession('demo',newer,a.generation);
    expect(a.generation).toBe(b.generation);
    expect(()=>b.saveSession('demo',{...initial,revision:2},b.generation)).toThrow('SETTINGS_CONFLICT');
    const before=b.snapshot();
    expect(()=>b.commit({...before,studio:{...before.studio,revision:3}},{source:'demo',session:{...initial,sessionId:'replacement'}})).toThrow('SETTINGS_CONFLICT');
    expect(b.snapshot()).toEqual(before);
    const restarted=await opened(dir);expect(restarted.snapshot()).toEqual(a.snapshot());expect(restarted.loadSessions('demo')).toEqual([newer]);
    // A different channel is an independent row, not a conflict with this one.
    b.saveSession('demo',newSession('201','independent'),b.generation);
    expect((await opened(dir)).loadSessions('demo')).toHaveLength(2);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('a killed process with spilled uncommitted pages recovers the previous settings and seats',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'entaku-settings-kill-'));
  let child:ReturnType<typeof Bun.spawn>|undefined;
  try{
    const store=await opened(dir),initial=newSession('200','committed');store.saveSession('demo',initial,store.generation);
    const before=store.snapshot(),file=join(dir,'settings.sqlite');
    const program=`
      import {Database} from 'bun:sqlite';
      const db=new Database(process.argv.at(-1));
      db.run('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
      db.query('UPDATE settings SET generation=99,document=? WHERE id=1').run('x'.repeat(1024*1024));
      db.run("UPDATE sessions SET document='uncommitted',version=99;");
      await Bun.write(Bun.stdout,'STAGED');
      await Bun.sleep(60000);
    `;
    const running=Bun.spawn([process.execPath,'-e',program,file],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});child=running;
    const reader=running.stdout.getReader();
    try{const first=await reader.read();expect(new TextDecoder().decode(first.value)).toBe('STAGED');}finally{reader.releaseLock();}
    expect(await Bun.file(file+'-journal').exists()).toBe(true);
    running.kill('SIGKILL');await running.exited;child=undefined;
    const restarted=await opened(dir);expect(restarted.snapshot()).toEqual(before);expect(restarted.loadSessions('demo')).toEqual([initial]);
    expect(await Bun.file(file+'-journal').exists()).toBe(false);
  }finally{if(child){child.kill('SIGKILL');await child.exited;}await rm(dir,{recursive:true,force:true,maxRetries:5});}
},15000);
