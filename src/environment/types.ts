import type {ParameterPreset,Theme} from '../presets/schema.ts';
import type {MisskeySettings} from '../contracts/misskey.ts';

export const ENVIRONMENT_LIMITS=Object.freeze({
  archiveBytes:512*1024*1024,unpackedBytes:512*1024*1024,
  fileBytes:128*1024*1024,manifestBytes:4*1024*1024,files:4096,
  identities:256,presentPeople:32,
});
export interface EnvironmentPerson {userId:string;username:string;displayName:string;iconAssetId?:string}
/** Saved appearance only. Live speech, voice flags and channel credentials never belong here. */
export interface EnvironmentPeople {identities:EnvironmentPerson[];presentUserIds:string[]}
export interface EnvironmentConfiguration {
  appVersion:string;createdAt:string;preset:ParameterPreset;misskey:MisskeySettings;people:EnvironmentPeople;
}
export interface EnvironmentFileReference {path:string;blob:string}
export interface EnvironmentPackageManifest extends EnvironmentConfiguration {
  schemaVersion:1;kind:'entaku-environment';
  images:string[];
  studios:Array<{bundleId:string;entry:string;files:EnvironmentFileReference[]}>;
  gaussians:Array<{assetId:string;files:EnvironmentFileReference[]}>;
  blobs:Array<{sha256:string;byteLength:number}>;
}
export interface EnvironmentPackageSummary {
  appVersion:string;createdAt:string;sha256:string;archiveBytes:number;unpackedBytes:number;
  counts:{studioBundles:number;images:number;gaussians:number;people:number;files:number};
  theme:Theme;
}
export interface EnvironmentStatus {generation:number;previewAvailable:boolean;limits:typeof ENVIRONMENT_LIMITS}
export interface EnvironmentInspection {summary:EnvironmentPackageSummary;revision:number;generation:number}
export interface EnvironmentImportResult {summary:EnvironmentPackageSummary;theme:Theme;generation:number;previewAvailable:boolean}
export interface EnvironmentVersion {expectedRevision:number;expectedGeneration:number}
export interface EnvironmentExportRequest extends EnvironmentVersion {theme:Theme}
export interface EnvironmentImportRequest extends EnvironmentVersion {sha256:string}

export function validateEnvironmentPeople(value:unknown):EnvironmentPeople {
  const fail=():never=>{throw new Error('ENVIRONMENT_PEOPLE_INVALID');};
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  const p=value as EnvironmentPeople;
  if(Object.keys(p).some(k=>!['identities','presentUserIds'].includes(k))||
    !Array.isArray(p.identities)||p.identities.length>ENVIRONMENT_LIMITS.identities||
    !Array.isArray(p.presentUserIds)||p.presentUserIds.length>ENVIRONMENT_LIMITS.presentPeople)return fail();
  const identities=p.identities.map(person=>{
    if(!person||typeof person!=='object'||Array.isArray(person)||Object.keys(person).some(k=>!['userId','username','displayName','iconAssetId'].includes(k))||
      typeof person.userId!=='string'||!/^\d{1,20}$/.test(person.userId)||
      typeof person.username!=='string'||!person.username||person.username.length>256||/[\x00-\x1f\x7f]/.test(person.username)||
      typeof person.displayName!=='string'||!person.displayName||person.displayName.length>256||/[\x00-\x1f\x7f]/.test(person.displayName)||
      (person.iconAssetId!==undefined&&(typeof person.iconAssetId!=='string'||!/^[a-f0-9]{64}$/.test(person.iconAssetId))))return fail();
    return {userId:person.userId,username:person.username,displayName:person.displayName,...(person.iconAssetId?{iconAssetId:person.iconAssetId}:{})};
  });
  const ids=new Set(identities.map(p=>p.userId));
  if(ids.size!==identities.length||new Set(p.presentUserIds).size!==p.presentUserIds.length||p.presentUserIds.some(id=>typeof id!=='string'||!ids.has(id)))return fail();
  return {identities,presentUserIds:[...p.presentUserIds]};
}
