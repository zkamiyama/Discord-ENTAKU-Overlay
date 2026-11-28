import type {MisskeySettings} from '../contracts/misskey.ts';

export const DEFAULT_MISSKEY_SETTINGS:Readonly<MisskeySettings> = Object.freeze({
  enabled:false, instanceUrl:'https://otomad.site', hashtag:'NicoMiss', localOnly:true,
  includeHome:false, maxCards:30, maxPerUser:1, lifetimeMs:45_000, maxCharacters:180,
  blockedWords:[], blockedUsers:[],
});

const keys = new Set<keyof MisskeySettings>([
  'enabled','instanceUrl','hashtag','localOnly','includeHome','maxCards','maxPerUser',
  'lifetimeMs','maxCharacters','blockedWords','blockedUsers',
]);
const invalid = ():never => {throw new Error('MISSKEY_SETTINGS_INVALID');};
const integer = (value:unknown,min:number,max:number):number => {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)return invalid();
  return value;
};

/** Only syntactic host boundaries are checked here. DNS resolution and proxy
 * routing belong to Bun; this validator does not pin resolved addresses. */
export function normalizeMisskeyInstance(value:unknown):string {
  if(typeof value!=='string'||value.length>255)return invalid();
  const input=value.trim(),match=/^https:\/\/([^/?#]+)\/?$/i.exec(input);
  if(!match||/[:@%\\\s]/u.test(match[1]!))return invalid();
  let url:URL;
  try{url=new URL(input);}catch{return invalid();}
  const host=url.hostname;
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||
    host.length>253||!host.includes('.')||host.endsWith('.')||
    !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||
    !/[a-z]/.test(host.split('.').at(-1)!)||
    /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|invalid|test|onion)$/.test(host)||
    host==='home.arpa'||host.endsWith('.home.arpa'))return invalid();
  return url.origin;
}

export function normalizeMisskeyTag(value:unknown):string {
  if(typeof value!=='string')return invalid();
  const tag=value.trim().replace(/^[#＃]+/u,'').trim();
  if(!tag||tag.length>128||/[\s#＃\p{Cc}\p{Cf}]/u.test(tag))return invalid();
  return tag;
}

export function validateMisskeySettings(value:unknown):MisskeySettings {
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(key=>!keys.has(key as keyof MisskeySettings))||
    typeof v.enabled!=='boolean'||typeof v.localOnly!=='boolean'||typeof v.includeHome!=='boolean'||
    !Array.isArray(v.blockedWords)||v.blockedWords.length>128||
    !Array.isArray(v.blockedUsers)||v.blockedUsers.length>256)return invalid();
  const words=v.blockedWords.map(word=>{
    if(typeof word!=='string'||!word.trim()||word.length>64||/[\p{Cc}\p{Cf}]/u.test(word))return invalid();
    return word.trim();
  });
  const users=v.blockedUsers.map(user=>{
    if(typeof user!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(user))return invalid();
    return user;
  });
  return {
    enabled:v.enabled,instanceUrl:normalizeMisskeyInstance(v.instanceUrl),hashtag:normalizeMisskeyTag(v.hashtag),
    localOnly:v.localOnly,includeHome:v.includeHome,
    maxCards:integer(v.maxCards,1,30),maxPerUser:integer(v.maxPerUser,1,3),
    lifetimeMs:integer(v.lifetimeMs,5_000,120_000),maxCharacters:integer(v.maxCharacters,40,400),
    blockedWords:[...new Set(words)],blockedUsers:[...new Set(users)],
  };
}
