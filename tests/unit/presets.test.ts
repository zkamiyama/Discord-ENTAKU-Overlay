import {expect,test} from 'bun:test';
import {mkdtemp,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PresetStore} from '../../src/presets/store.ts';
import {capturePreset,presetFilename,seatingSession,validatePreset} from '../../src/presets/schema.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
const fixture=()=>{const e=new AppEngine({source:'demo',serverEpoch:'test'});for(const v of demoEvents())e.apply(v);return e;};
test('preset captures every settings group and role/seat assignments but not live state',()=>{
 const e=fixture(),p=capturePreset(e.snapshot(),'light');
 for(const group of ['exposure','direction','post','quality'])expect(Object.hasOwn(p.studio,group)).toBe(true);
 expect(p.seating.assignments).toHaveLength(6);expect(p.seating.moderatorSlots).toEqual([0]);
 expect(JSON.stringify(p)).not.toContain('speaking');expect(JSON.stringify(p)).not.toContain('avatarUrl');expect(JSON.stringify(p)).not.toContain('channelId');
 expect(validatePreset(p)).toEqual(p);expect(()=>validatePreset({...p,schemaVersion:99})).toThrow('PRESET_INVALID');
 expect(()=>seatingSession({...p.seating,channelId:'999'} as any,'1','x')).toThrow('PRESET_SEATING_INVALID');
});
test('file-backed preset list reflects external edits; bad JSON is isolated; create cannot overwrite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-presets-'));try{
 const store=new PresetStore(dir),p=capturePreset(fixture().snapshot(),'system');
 expect(await store.create('夜の討論',p)).toBe('夜の討論.json');expect((await store.list())[0]).toEqual({name:'夜の討論.json',valid:true});
 expect(await store.read('夜の討論.json')).toEqual(p);
 await expect(store.create('夜の討論.json',{...p,theme:'dark'})).rejects.toThrow('PRESET_EXISTS');
 expect(JSON.parse(await readFile(join(dir,'presets','夜の討論.json'),'utf8')).theme).toBe('system');
 await writeFile(join(dir,'presets','外部.json'),JSON.stringify({...p,theme:'dark'}));await writeFile(join(dir,'presets','壊れた.json'),'{');await writeFile(join(dir,'presets','大文字.JSON'),JSON.stringify(p));
 expect(await store.list()).toContainEqual({name:'外部.json',valid:true});expect(await store.list()).toContainEqual({name:'大文字.JSON',valid:true});expect((await store.list()).find(p=>p.name==='壊れた.json')?.valid).toBe(false);
 expect((await store.read('外部.json')).theme).toBe('dark');expect((await readdir(join(dir,'presets'))).filter(n=>n.endsWith('.tmp'))).toEqual([]);
 await store.preferences(p);expect(await new PresetStore(dir).preferences()).toEqual(p);await store.preferences(null);expect(await store.preferences()).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unsafe filenames and missing assets are never redirected outside the preset folder',()=>{
 for(const name of ['../x','C:\\x','CON','NUL.json','foo.','a/b','a?b',''])expect(()=>presetFilename(name)).toThrow('PRESET_NAME_INVALID');
 expect(presetFilename('  討論 1.JSON  ')).toBe('討論 1.json');
});
test('applying a preset reconciles real presence, preserves Discord connection and restores reserved placement',()=>{
 const e=fixture(),p=capturePreset(e.snapshot(),'dark'),id=e.snapshot().participants[1]!.userId;
 e.control({type:'seat-move',userId:id,slotIndex:4},e.snapshot().revision,3000);
 const before=e.snapshot();e.applyPreset({...p,autoCamera:false},before.revision,3100);
 expect(e.snapshot().mode).toBe('HOLD');expect(e.snapshot().channel).toEqual(before.channel);expect(e.snapshot().connection).toBe(before.connection);
 expect(e.snapshot().session.reservations.find(r=>r.userId===id)?.slotIndex).toBe(p.seating.assignments.find(r=>r.userId===id)?.slotIndex);
 expect(e.snapshot().participants).toEqual(before.participants);expect(e.snapshot().camera.shot.kind).toBe('WIDE');
 expect(()=>e.applyPreset({...p,seating:{...p.seating,capacity:100}},e.snapshot().revision,3200)).toThrow();expect(e.snapshot().mode).toBe('HOLD');
});

test('preset automatic OFF survives application startup and a subsequent channel snapshot',()=>{
 const p=capturePreset(fixture().snapshot(),'dark');
 const e=new AppEngine({source:'demo',serverEpoch:'restart',seatingDefaults:p.seating,autoCamera:false});
 for(const event of demoEvents())e.apply(event);expect(e.snapshot().mode).toBe('HOLD');
 e.apply({type:'snapshot',channel:{channelId:'222',kind:'guild-voice',name:'another'},participants:[],sourceGeneration:2,receivedAtMs:5000});
 expect(e.snapshot().mode).toBe('HOLD');expect(e.snapshot().session.moderatorSlots).toEqual(p.seating.moderatorSlots);
});
