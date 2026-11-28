import defaults from '../../config/note-introduction.json';
import type {NoteIntroductionSettings} from '../contracts/note-introduction.ts';
import {normalizeMisskeyInstance} from '../misskey/settings.ts';

/** Shared by the Dock and server. Configuration contains origins, never tokens. */
export function validateNoteIntroductionSettings(value:unknown):NoteIntroductionSettings {
  const invalid=():never=>{throw new Error('NOTE_INTRODUCTION_SETTINGS_INVALID');};
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(key=>!['schemaVersion','enabled','instances','includeHome'].includes(key))||
    v.schemaVersion!==1||typeof v.enabled!=='boolean'||typeof v.includeHome!=='boolean'||
    !Array.isArray(v.instances)||v.instances.length>8||(v.enabled&&!v.instances.length))return invalid();
  let instances:string[];
  try{instances=v.instances.map(normalizeMisskeyInstance);}catch{return invalid();}
  if(new Set(instances).size!==instances.length)return invalid();
  return {schemaVersion:1,enabled:v.enabled,instances,includeHome:v.includeHome};
}
export const DEFAULT_NOTE_INTRODUCTION_SETTINGS:Readonly<NoteIntroductionSettings>=Object.freeze(validateNoteIntroductionSettings(defaults));
