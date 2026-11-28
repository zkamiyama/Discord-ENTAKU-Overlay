import {open} from 'node:fs/promises';
import type {NoteIntroductionSettings} from '../contracts/note-introduction.ts';
import {validateNoteIntroductionSettings} from './settings.ts';

/** Explicit import only. The saved configuration remains the runtime source
 * after this file is read; an old file never silently overwrites a package. */
export async function readNoteIntroductionConfig(path:string):Promise<NoteIntroductionSettings> {
  try{
    const file=await open(path,'r');
    try{
      const info=await file.stat();
      if(!info.isFile()||info.size>32768)throw new Error('NOTE_INTRODUCTION_CONFIG_INVALID');
      const bytes=Buffer.alloc(info.size+1);let length=0;
      while(length<bytes.length){const part=await file.read(bytes,length,bytes.length-length,null);if(!part.bytesRead)break;length+=part.bytesRead;}
      if(length!==info.size)throw new Error('NOTE_INTRODUCTION_CONFIG_INVALID');
      return validateNoteIntroductionSettings(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length))));
    }finally{await file.close();}
  }catch(error){throw new Error('NOTE_INTRODUCTION_CONFIG_INVALID',{cause:error});}
}
