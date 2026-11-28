/** Public social notes have an independent lifetime from voice state and recordings. */
export const MISSKEY_CARD_LIMIT = 30;
export const MISSKEY_QUEUE_LIMIT = 60;
export interface MisskeySettings {
  enabled:boolean;
  instanceUrl:string;
  hashtag:string;
  localOnly:boolean;
  includeHome:boolean;
  maxCards:number;
  maxPerUser:number;
  lifetimeMs:number;
  maxCharacters:number;
  blockedWords:string[];
  blockedUsers:string[];
}
export type MisskeyStatus='disabled'|'connecting'|'live'|'reconnecting'|'error';
export type MisskeyRejectReason='invalid'|'not-public'|'remote'|'wrong-tag'|'sensitive'|'empty'|'blocked-word'|'blocked-user'|'repetition'|'duplicate'|'user-limit'|'queue-full'|'too-old'|'rate-limit';
export interface MisskeyCard {
  id:string;userId:string;username:string;authorName:string;text:string;url:string;
  createdAt:string;shownAt:number;expiresAt:number;slot:number;truncated:boolean;
}
export interface MisskeyState {
  revision:number;status:MisskeyStatus;errorCode:string|null;
  instanceUrl:string;hashtag:string;localOnly:boolean;includeHome:boolean;
  cards:MisskeyCard[];queued:number;received:number;accepted:number;
  rejected:Partial<Record<MisskeyRejectReason,number>>;
  reconnects:number;lastEventAt:number|null;retryAt:number|null;
  recoveryTruncated:boolean;paused:boolean;
}
export function emptyMisskeyState():MisskeyState {
  return {revision:0,status:'disabled',errorCode:null,instanceUrl:'https://otomad.site',hashtag:'NicoMiss',localOnly:true,includeHome:false,cards:[],queued:0,received:0,accepted:0,rejected:{},reconnects:0,lastEventAt:null,retryAt:null,recoveryTruncated:false,paused:false};
}
const reasons=new Set<MisskeyRejectReason>(['invalid','not-public','remote','wrong-tag','sensitive','empty','blocked-word','blocked-user','repetition','duplicate','user-limit','queue-full','too-old','rate-limit']);
const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const short=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
export function parseMisskeyState(value:unknown):MisskeyState|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as MisskeyState;
  if(!integer(v.revision)||!['disabled','connecting','live','reconnecting','error'].includes(v.status)||
    !(v.errorCode===null||short(v.errorCode,96))||!short(v.instanceUrl,255)||!short(v.hashtag,128)||typeof v.localOnly!=='boolean'||typeof v.includeHome!=='boolean'||
    !Array.isArray(v.cards)||v.cards.length>MISSKEY_CARD_LIMIT||!integer(v.queued,MISSKEY_QUEUE_LIMIT)||
    !integer(v.received)||!integer(v.accepted)||!integer(v.reconnects)||!(v.lastEventAt===null||integer(v.lastEventAt))||
    !(v.retryAt===null||integer(v.retryAt))||typeof v.recoveryTruncated!=='boolean'||typeof v.paused!=='boolean'||
    !v.rejected||typeof v.rejected!=='object'||Array.isArray(v.rejected)||
    Object.entries(v.rejected).some(([key,n])=>!reasons.has(key as MisskeyRejectReason)||!integer(n)))return null;
  let origin:string;
  try{const u=new URL(v.instanceUrl);if(u.protocol!=='https:'||u.origin!==v.instanceUrl||u.username||u.password)return null;origin=u.origin;}catch{return null;}
  const ids=new Set<string>(),slots=new Set<number>();
  for(const card of v.cards){
    if(!card||typeof card!=='object'||!short(card.id,128)||!card.id||!/^[A-Za-z0-9_-]+$/.test(card.id)||
      !short(card.userId,128)||!card.userId||!short(card.username,128)||!short(card.authorName,256)||!short(card.text,2000)||
      !short(card.createdAt,40)||!Number.isFinite(Date.parse(card.createdAt))||
      !integer(card.shownAt)||!integer(card.expiresAt)||card.expiresAt<=card.shownAt||card.expiresAt-card.shownAt>120000||
      !integer(card.slot,MISSKEY_CARD_LIMIT-1)||typeof card.truncated!=='boolean'||
      card.url!==`${origin}/notes/${card.id}`||ids.has(card.id)||slots.has(card.slot))return null;
    ids.add(card.id);slots.add(card.slot);
  }
  return v;
}
