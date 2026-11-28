import {validateProfile, type AvatarProfile} from '../assets/avatar-profile.ts';
import {seatingParameters, seatingSession, type ParameterPreset, type SeatingPreset, type Theme} from '../presets/schema.ts';
import {DEFAULT_STUDIO_SCENE, validateStudioScene, type StudioScene} from '../studio/manifest.ts';
import type {MisskeySettings} from '../contracts/misskey.ts';
import {DEFAULT_MISSKEY_SETTINGS,validateMisskeySettings} from '../misskey/settings.ts';
import {validateEnvironmentPeople,type EnvironmentPeople} from '../environment/types.ts';

export interface SettingsPreferences {seating:SeatingPreset;autoCamera:boolean;theme:Theme}
export interface SettingsData {studio:StudioScene;avatarProfiles:AvatarProfile[];preferences:SettingsPreferences|null;misskey?:MisskeySettings;environment?:EnvironmentPeople|null}
export interface SettingsSnapshot extends SettingsData {schemaVersion:1;generation:number;misskey:MisskeySettings;environment:EnvironmentPeople|null}

export function presetPreferences(preset:ParameterPreset):SettingsPreferences {
  return {seating:structuredClone(preset.seating),autoCamera:preset.autoCamera,theme:preset.theme};
}
export function defaultSettings():SettingsData {
  return {studio:structuredClone(DEFAULT_STUDIO_SCENE),avatarProfiles:[],preferences:null,misskey:structuredClone(DEFAULT_MISSKEY_SETTINGS),environment:null};
}
export function validateSettings(value:unknown):SettingsSnapshot {
  const v=value as SettingsSnapshot;
  if(!v||typeof v!=='object'||Array.isArray(v)||v.schemaVersion!==1||!Number.isSafeInteger(v.generation)||v.generation<0||
    Object.keys(v).some(key=>!['schemaVersion','generation','studio','avatarProfiles','preferences','misskey','environment'].includes(key))||
    !Array.isArray(v.avatarProfiles)||v.avatarProfiles.length>256)throw new Error('SETTINGS_INVALID');
  const studio=validateStudioScene(v.studio),avatarProfiles=v.avatarProfiles.map(validateProfile);
  if(new Set(avatarProfiles.map(p=>p.userId)).size!==avatarProfiles.length)throw new Error('SETTINGS_INVALID');
  let preferences:SettingsPreferences|null=null;
  if(v.preferences!==null){
    const p=v.preferences;
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(key=>!['seating','autoCamera','theme'].includes(key))||
      typeof p.autoCamera!=='boolean'||!['system','light','dark'].includes(p.theme))throw new Error('SETTINGS_INVALID');
    preferences={seating:seatingParameters(seatingSession(p.seating,'0','settings')),autoCamera:p.autoCamera,theme:p.theme};
  }
  // Existing schema-1 documents predate this optional feature. Validate a
  // present value strictly; absence alone supplies the disabled default.
  const misskey=v.misskey===undefined?structuredClone(DEFAULT_MISSKEY_SETTINGS):validateMisskeySettings(v.misskey);
  const environment=v.environment===undefined||v.environment===null?null:validateEnvironmentPeople(v.environment);
  return {schemaVersion:1,generation:v.generation,studio,avatarProfiles,preferences,misskey,environment};
}
