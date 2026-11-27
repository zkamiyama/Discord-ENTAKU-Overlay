import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {validateProfile} from '../assets/avatar-profile.ts';
import {validatePreset} from '../presets/schema.ts';
import {validateStudioScene} from '../studio/manifest.ts';
import {defaultSettings,presetPreferences,type SettingsData} from './settings-schema.ts';

async function readOptional(path:string,limit:number,code:string):Promise<unknown|undefined>{
  try{
    const file=await open(path,'r');
    try{
      const stat=await file.stat();
      if(!stat.isFile()||stat.size>limit)throw new Error(code);
      const bytes=Buffer.alloc(stat.size+1);let length=0;
      while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}
      if(length!==stat.size)throw new Error(code);
      return JSON.parse(bytes.subarray(0,length).toString('utf8'));
    }finally{await file.close();}
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;
    throw new Error(code,{cause:error});
  }
}

/** Read-only, one-time import. Never remove or rewrite the user's original files. */
export async function readLegacySettings(directory:string):Promise<SettingsData>{
  const [scene,avatars,preset]=await Promise.all([
    readOptional(join(directory,'scene.json'),1024*1024,'STUDIO_SETTINGS_READ_FAILED'),
    readOptional(join(directory,'avatars.json'),2*1024*1024,'AVATAR_SETTINGS_READ_FAILED'),
    readOptional(join(directory,'preset-state.json'),2*1024*1024,'PRESET_STATE_READ_FAILED'),
  ]);
  const result=defaultSettings();
  if(scene!==undefined){try{result.studio=validateStudioScene(scene);}catch(error){throw new Error('STUDIO_SETTINGS_READ_FAILED',{cause:error});}}
  if(avatars!==undefined){
    try{
      const value=avatars as {schemaVersion:number;profiles:unknown[]};
      if(!value||![1,2].includes(value.schemaVersion)||!Array.isArray(value.profiles)||value.profiles.length>256)throw new Error();
      result.avatarProfiles=value.profiles.map(validateProfile);
      if(new Set(result.avatarProfiles.map(p=>p.userId)).size!==result.avatarProfiles.length)throw new Error();
    }catch(error){throw new Error('AVATAR_SETTINGS_READ_FAILED',{cause:error});}
  }
  if(preset!==undefined){try{result.preferences=presetPreferences(validatePreset(preset));}catch(error){throw new Error('PRESET_STATE_READ_FAILED',{cause:error});}}
  return result;
}
