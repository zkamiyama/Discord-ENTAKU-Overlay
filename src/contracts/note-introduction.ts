/** A single manually ended introduction, separate from the 3D hashtag cards. */
export interface NoteIntroductionSettings {
  schemaVersion:1;
  enabled:boolean;
  instances:string[];
  includeHome:boolean;
}
export interface IntroducedNote {
  presentationId:number;
  id:string;
  url:string;
  instanceUrl:string;
  userId:string;
  username:string;
  authorName:string;
  userHost:string|null;
  text:string;
  createdAt:string;
  attachmentCount:number;
  sourceMessageId:string;
  sourceChannelId:string;
  introducedBy:string;
}
export interface NoteIntroductionState {
  revision:number;
  status:'disabled'|'idle'|'loading'|'showing'|'error';
  card:IntroducedNote|null;
  pendingUrl:string|null;
  errorCode:string|null;
  retryAt:number|null;
}
export function emptyNoteIntroduction(enabled=false):NoteIntroductionState {
  return {revision:0,status:enabled?'idle':'disabled',card:null,pendingUrl:null,errorCode:null,retryAt:null};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const id=(v:unknown):v is string=>text(v,128)&&/^[A-Za-z0-9_-]+$/.test(v);
const snowflake=(v:unknown):v is string=>text(v,20)&&/^\d{1,20}$/.test(v);
function noteUrl(v:unknown):v is string {
  if(!text(v,512))return false;
  try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/notes\/[A-Za-z0-9_-]{1,128}$/.test(u.pathname);}catch{return false;}
}
/** Reject malformed social data instead of retaining a stale on-air card. */
export function parseNoteIntroductionState(value:unknown):NoteIntroductionState|null {
  if(!object(value)||!integer(value.revision)||typeof value.status!=='string'||!['disabled','idle','loading','showing','error'].includes(value.status)||
    !(value.pendingUrl===null||noteUrl(value.pendingUrl))||
    !(value.errorCode===null||text(value.errorCode,96)&&/^[A-Z_0-9]+$/.test(value.errorCode))||
    !(value.retryAt===null||integer(value.retryAt)))return null;
  const c=value.card;
  if(c!==null){
    if(!object(c)||!integer(c.presentationId)||!id(c.id)||!noteUrl(c.url)||
      !text(c.instanceUrl,255)||c.url!==`${c.instanceUrl}/notes/${c.id}`||new URL(c.url).origin!==c.instanceUrl||
      !id(c.userId)||!text(c.username,128)||!c.username||!text(c.authorName,512)||
      !(c.userHost===null||text(c.userHost,253))||!text(c.text,32768)||
      !text(c.createdAt,40)||!Number.isFinite(Date.parse(c.createdAt))||!integer(c.attachmentCount,64)||
      !snowflake(c.sourceMessageId)||!snowflake(c.sourceChannelId)||!text(c.introducedBy,100))return null;
  }
  if(value.status==='showing'&&c===null||value.status==='disabled'&&(c!==null||value.pendingUrl!==null)||
    value.status==='idle'&&(c!==null||value.pendingUrl!==null)||value.status==='loading'&&value.pendingUrl===null)return null;
  return value as unknown as NoteIntroductionState;
}
