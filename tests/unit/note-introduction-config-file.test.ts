import {expect,test} from 'bun:test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readNoteIntroductionConfig} from '../../src/note-introduction/config-file.ts';
import {parseOptions} from '../../src/cli-options.ts';
import type {NoteIntroductionSettings} from '../../src/contracts/note-introduction.ts';

test('CLI imports explicit settings files with a byte limit and strict schema',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'entaku-note-config-'));
  try{
    const path=join(directory,'notes.json'),value:NoteIntroductionSettings={schemaVersion:1,enabled:true,instances:['https://another.example.org'],includeHome:true};
    await writeFile(path,JSON.stringify(value));expect(await readNoteIntroductionConfig(path)).toEqual(value);
    expect(parseOptions(['--note-introduction-config',path]).noteIntroductionConfigPath).toBe(path);
    expect(()=>parseOptions(['--note-introduction-config'])).toThrow('MISSING_ARGUMENT');
    for(const content of ['{bad json',JSON.stringify({...value,instances:['http://127.0.0.1']}),JSON.stringify({...value,unexpected:true}),' '.repeat(32769)]){
      await writeFile(path,content);await expect(readNoteIntroductionConfig(path)).rejects.toThrow('NOTE_INTRODUCTION_CONFIG_INVALID');
    }
    await mkdir(join(directory,'folder'));await expect(readNoteIntroductionConfig(join(directory,'folder'))).rejects.toThrow('NOTE_INTRODUCTION_CONFIG_INVALID');
    await expect(readNoteIntroductionConfig(join(directory,'missing.json'))).rejects.toThrow('NOTE_INTRODUCTION_CONFIG_INVALID');
  }finally{await rm(directory,{recursive:true,force:true});}
});
