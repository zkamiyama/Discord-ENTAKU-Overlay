import {createHash} from 'node:crypto';
import {parse,type MfmNode} from 'mfm-js';
import type {MisskeyCard,MisskeyRejectReason,MisskeySettings} from '../contracts/misskey.ts';

export const MISSKEY_MAX_INPUT_UNITS=16_000;
export const MISSKEY_MAX_AGE_MS=120_000;
/** Small, original phrases for a mechanical broadcast filter. This cannot
 * infer intent or distinguish a quotation from a threat; operators can extend
 * it. Broad words such as "殺害予告" are deliberately not dictionary entries. */
export const DEFAULT_BLOCKED_PHRASES:readonly string[]=Object.freeze([
  '殺してやる','殺しに行く','ぶっ殺す','皆殺しにする','お前を殺す',
  'おまえをころす','ころしてやる','爆破してやる','爆破しに行く','i will kill you',
]);
const segmenter=new Intl.Segmenter('ja',{granularity:'grapheme'});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const validMisskeyId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const cleanDisplay=(text:string,preserveWhitespace=false):string=>{
  const safe=text.replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'');
  return preserveWhitespace?safe:safe.replace(/\t/g,' ').replace(/\n{3,}/g,'\n\n').trim();
};

export function normalizeModerationText(text:string):string {
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{Cf}\p{Cc}]/gu,'');
}

interface StaticMfm {text:string;tags:string[]}
/** Formatting and animation are interpreted only as text. No HTML, images,
 * custom emoji downloads, links, or MFM evaluation are created. */
function staticMfm(input:string,preserveWhitespace=false):StaticMfm {
  const tree=parse(input,{nestLimit:8}),stack:Array<MfmNode|string>=[...tree].reverse();
  const out:string[]=[],tags:string[]=[];let visited=0,units=0;
  const append=(text:string)=>{units+=text.length;if(units>MISSKEY_MAX_INPUT_UNITS+1024)throw Error('MFM_TOO_LARGE');out.push(text);};
  while(stack.length){
    const node=stack.pop()!;
    if(typeof node==='string'){append(node);continue;}
    if(++visited>4096)throw Error('MFM_TOO_COMPLEX');
    switch(node.type){
      case 'text':append(node.props.text);break;
      case 'unicodeEmoji':append(node.props.emoji);break;
      case 'emojiCode':append(`:${node.props.name}:`);break;
      case 'mention':append(node.props.acct.startsWith('@')?node.props.acct:`@${node.props.acct}`);break;
      case 'hashtag':append(`#${node.props.hashtag}`);tags.push(node.props.hashtag);break;
      case 'url':append(node.props.url);break;
      case 'search':append(node.props.content);break;
      case 'inlineCode':append(node.props.code);break;
      case 'blockCode':append(`\n${node.props.code}\n`);break;
      case 'mathInline':append(node.props.formula);break;
      case 'mathBlock':append(`\n${node.props.formula}\n`);break;
      default:{
        const block=node.type==='quote'||node.type==='center';
        if(block){append('\n');stack.push('\n');}
        for(let i=node.children.length-1;i>=0;i--)stack.push(node.children[i]!);
      }
    }
  }
  return {text:cleanDisplay(out.join(''),preserveWhitespace),tags};
}
export function staticMfmText(input:string,options:{preserveWhitespace?:boolean}={}):string {
  if(input.length>MISSKEY_MAX_INPUT_UNITS)throw Error('MFM_TOO_LARGE');
  return staticMfm(input,options.preserveWhitespace).text;
}

/** Count visible grapheme clusters, preserving emoji sequences and combining
 * marks. The unit ceiling additionally bounds the wire and texture input. */
export function truncateGraphemes(value:string,limit:number,maxUnits=1900):{text:string;truncated:boolean} {
  const pieces:string[]=[];let units=0;
  for(const item of segmenter.segment(value)){
    if(pieces.length>=limit||units+item.segment.length>maxUnits){
      while(pieces.length>=limit||units+1>maxUnits){units-=pieces.pop()!.length;}
      return {text:pieces.join('')+'…',truncated:true};
    }
    pieces.push(item.segment);units+=item.segment.length;
  }
  return {text:pieces.join(''),truncated:false};
}

export function hasMechanicalRepetition(text:string):boolean {
  const chars=[...segmenter.segment(text)].map(item=>item.segment);
  // Retain the input-complexity guard for a single pathological grapheme;
  // repeated ordinary graphemes (cheers, laughter, emoji) are allowed.
  const kinds=new Set<string>();
  for(const char of chars){
    if(char.length>64)return true;
    if(kinds.size<3)kinds.add(char);
  }
  if(kinds.size<3)return false;
  const minUnit=5,maxUnit=64,minCopies=5;
  const minSpan=Math.max(30,Math.ceil(chars.length*3/5));
  // A phrase must dominate the full normalized input, not just its preview.
  // Every qualifying span contains the comparison pair centred in the input.
  // Check only the run through that pair: at most 60 bounded linear scans,
  // with nonmatching and short-unit candidates discarded before scanning.
  for(let period=minUnit;period<=Math.min(maxUnit,Math.floor(chars.length/minCopies));period++){
    const required=Math.max(minSpan,period*minCopies);
    if(required>chars.length)continue;
    const middle=Math.floor((chars.length+period)/2);
    if(chars[middle]!==chars[middle-period])continue;
    const unit=chars.slice(middle-period,middle);
    if(new Set(unit).size<3)continue;
    // Do not misclassify bundled short replies, e.g. "haha" or "わーい",
    // as a longer phrase. A proper repeated unit must divide this period.
    let shortUnit=false;
    for(let shorter=1;shorter<minUnit;shorter++){
      if(period%shorter===0&&unit.every((char,index)=>char===unit[index%shorter])){shortUnit=true;break;}
    }
    if(shortUnit)continue;
    let start=middle,end=middle+1;
    while(start>period&&chars[start-1]===chars[start-1-period])start--;
    while(end<chars.length&&chars[end]===chars[end-period])end++;
    if(end-start+period>=required)return true;
  }
  return false;
}

export type MisskeyCandidate=Omit<MisskeyCard,'shownAt'|'expiresAt'|'slot'>;
export type ModeratedMisskeyNote=
  | {ok:true;note:MisskeyCandidate;fingerprint:string;createdAtMs:number}
  | {ok:false;reason:MisskeyRejectReason};

export function moderateMisskeyNote(raw:unknown,settings:MisskeySettings,now:number):ModeratedMisskeyNote {
  const reject=(reason:MisskeyRejectReason):ModeratedMisskeyNote=>({ok:false,reason});
  if(!record(raw)||!validMisskeyId(raw.id)||!record(raw.user)||!validMisskeyId(raw.user.id))return reject('invalid');
  const user=raw.user,userId=raw.user.id;
  const flags=[raw.isHidden,raw.hidden,raw.isSensitive,raw.sensitive,user.requireSigninToViewContents,user.isSuspended];
  if(flags.some(value=>value!==undefined&&typeof value!=='boolean')||
    raw.visibleUserIds!==undefined&&!Array.isArray(raw.visibleUserIds))return reject('invalid');
  if(raw.visibility!=='public'&&!(settings.includeHome&&raw.visibility==='home')||raw.isHidden===true||
    raw.hidden===true||user.requireSigninToViewContents===true||user.isSuspended===true||
    Array.isArray(raw.visibleUserIds)&&raw.visibleUserIds.length>0)return reject('not-public');
  if(settings.localOnly&&user.host!=null)return reject('remote');
  if(user.host!=null&&(typeof user.host!=='string'||user.host.length>253))return reject('invalid');
  if(settings.blockedUsers.includes(userId))return reject('blocked-user');
  if(raw.cw!=null||raw.isSensitive===true||raw.sensitive===true)return reject('sensitive');
  if(raw.files!==undefined&&(!Array.isArray(raw.files)||raw.files.length>64))return reject('invalid');
  if(Array.isArray(raw.files)){
    if(raw.files.some(file=>!record(file)||file.isSensitive!==undefined&&typeof file.isSensitive!=='boolean'))return reject('invalid');
    if(raw.files.some(file=>(file as Record<string,unknown>).isSensitive===true))return reject('sensitive');
  }
  if(typeof raw.createdAt!=='string'||raw.createdAt.length>40)return reject('invalid');
  const createdAtMs=Date.parse(raw.createdAt);
  if(!Number.isFinite(createdAtMs)||createdAtMs<0||createdAtMs>now+60_000)return reject('invalid');
  if(createdAtMs<now-MISSKEY_MAX_AGE_MS)return reject('too-old');
  if(raw.text==null||raw.text==='')return reject('empty');
  if(typeof raw.text!=='string'||raw.text.length>MISSKEY_MAX_INPUT_UNITS||
    typeof user.username!=='string'||!/^[A-Za-z0-9_]{1,128}$/.test(user.username)||
    user.name!=null&&(typeof user.name!=='string'||user.name.length>256))return reject('invalid');
  if(raw.tags!==undefined&&(!Array.isArray(raw.tags)||raw.tags.length>64||
    raw.tags.some(tag=>typeof tag!=='string'||tag.length>128)))return reject('invalid');
  let parsed:StaticMfm,authorName:string;
  try{
    parsed=staticMfm(raw.text);
    authorName=staticMfm(typeof user.name==='string'&&user.name?user.name:user.username).text||user.username;
  }catch{return reject('invalid');}
  if(!parsed.text)return reject('empty');
  const tagKey=settings.hashtag.normalize('NFKC').toLowerCase();
  if(![...parsed.tags,...(raw.tags as string[]|undefined??[])].some(tag=>tag.normalize('NFKC').toLowerCase()===tagKey))return reject('wrong-tag');
  const normalized=normalizeModerationText(parsed.text),name=normalizeModerationText(authorName),username=normalizeModerationText(user.username);
  if([...DEFAULT_BLOCKED_PHRASES,...settings.blockedWords].some(word=>{
    const needle=normalizeModerationText(word);return !!needle&&(normalized.includes(needle)||name.includes(needle)||username.includes(needle));
  }))return reject('blocked-word');
  const repetitionText=normalized.replaceAll(normalizeModerationText(`#${settings.hashtag}`),'');
  if(hasMechanicalRepetition(repetitionText)||hasMechanicalRepetition(name))return reject('repetition');
  const display=truncateGraphemes(parsed.text,settings.maxCharacters);
  return {ok:true,createdAtMs,fingerprint:createHash('sha256').update(normalized).digest('hex'),note:{
    id:raw.id,userId,username:user.username,authorName:truncateGraphemes(authorName,64,256).text,
    text:display.text,url:`${settings.instanceUrl}/notes/${raw.id}`,createdAt:new Date(createdAtMs).toISOString(),truncated:display.truncated,
  }};
}
