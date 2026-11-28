import {expect,test} from 'bun:test';
import {DEFAULT_MISSKEY_SETTINGS} from '../../src/misskey/settings.ts';
import {hasMechanicalRepetition,moderateMisskeyNote,staticMfmText,truncateGraphemes} from '../../src/misskey/moderation.ts';
import type {MisskeyRejectReason} from '../../src/contracts/misskey.ts';

const now=1_800_000_000_000;
const settings={...DEFAULT_MISSKEY_SETTINGS,enabled:true};
const note=(patch:Record<string,unknown>={})=>({id:'note1',createdAt:new Date(now).toISOString(),visibility:'public',text:'投稿をテストしています #NicoMiss',cw:null,
  user:{id:'user1',username:'tester',name:'テスト投稿者',host:null},files:[],...patch});
const rejected=(value:unknown,reason:MisskeyRejectReason,config=settings)=>expect(moderateMisskeyNote(value,config,now)).toEqual({ok:false,reason});

test('public local note produces only bounded plain data and an origin-derived URL',()=>{
  const value=moderateMisskeyNote(note({url:'javascript:alert(1)',uri:'https://private.invalid/',files:[{url:'https://tracking.invalid/a.png',isSensitive:false}]}),settings,now);
  expect(value.ok).toBe(true);if(!value.ok)return;
  expect(value.note).toMatchObject({id:'note1',userId:'user1',authorName:'テスト投稿者',text:'投稿をテストしています #NicoMiss',url:'https://otomad.site/notes/note1',truncated:false});
  expect(JSON.stringify(value)).not.toMatch(/private|tracking|javascript/);
  expect(value.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});

test('visibility defaults to public; home requires explicit inclusion and private states always fail',()=>{
  rejected(note({visibility:'home'}),'not-public');
  expect(moderateMisskeyNote(note({visibility:'home'}),{...settings,includeHome:true},now).ok).toBe(true);
  for(const visibility of ['followers','specified','private',null,undefined])rejected(note({visibility}),'not-public',{...settings,includeHome:true});
  rejected(note({isHidden:true}),'not-public');rejected(note({visibleUserIds:['private-user']}),'not-public');
  rejected(note({user:{id:'user1',username:'tester',host:null,requireSigninToViewContents:true}}),'not-public');
});

test('local-only checks account origin; federation is opt-in and custom blocked users apply',()=>{
  const raw=note({user:{id:'remote1',username:'remote',name:'リモート',host:'misskey.example.com'}});
  rejected(raw,'remote');expect(moderateMisskeyNote(raw,{...settings,localOnly:false},now).ok).toBe(true);
  rejected(note(),'blocked-user',{...settings,blockedUsers:['user1']});
});

test('CW and marked sensitive files are rejected even if their preview would be text only',()=>{
  rejected(note({cw:'閲覧注意'}),'sensitive');rejected(note({cw:''}),'sensitive');
  rejected(note({isSensitive:true}),'sensitive');rejected(note({files:[{isSensitive:true}]}),'sensitive');
});

test('malformed privacy and sensitive flags cannot silently become false',()=>{
  for(const key of ['isHidden','hidden','isSensitive','sensitive'])rejected(note({[key]:'true'}),'invalid');
  rejected(note({files:[{isSensitive:'true'}]}),'invalid');rejected(note({files:[null]}),'invalid');
  rejected(note({visibleUserIds:'private-user'}),'invalid');
  rejected(note({user:{id:'user1',username:'tester',host:null,requireSigninToViewContents:'true'}}),'invalid');
});

test('hashtag extraction uses MFM tokens when packed Note omits tags, with case-insensitive matching',()=>{
  expect(moderateMisskeyNote(note({text:'日本語 #nicomiss'}),settings,now).ok).toBe(true);
  rejected(note({text:'違うタグ #AnotherTag'}),'wrong-tag');
  rejected(note({text:'`#NicoMiss` はコードです'}),'wrong-tag');
  expect(moderateMisskeyNote(note({text:'タグをパックする派生実装',tags:['NicoMiss']}),settings,now).ok).toBe(true);
  rejected(note({tags:[null]}),'invalid');
});

test('MFM becomes static readable text, leaving HTML inert and emoji names literal',()=>{
  expect(staticMfmText('$[spin **こんにちは**] :sample: [公式](https://example.com) @tester #NicoMiss')).toBe('こんにちは :sample: 公式 @tester #NicoMiss');
  const raw=note({text:'<img src=x onerror=alert(1)> #NicoMiss'}),value=moderateMisskeyNote(raw,settings,now);
  expect(value.ok).toBe(true);if(value.ok)expect(value.note.text).toContain('<img');
  expect(staticMfmText('最初\n\n\n最後\u202e')).toBe('最初\n\n最後');
});

test('threat seed and custom words inspect the full normalized body before truncation and also author names',()=>{
  rejected(note({text:'殺 し**て**やる #NicoMiss'}),'blocked-word');
  rejected(note({text:'Ｉ ＷＩＬＬ ＫＩＬＬ ＹＯＵ #NicoMiss'}),'blocked-word');
  rejected(note({text:'あいうえおかきくけこさしすせそたちつてと'.repeat(12)+'お前を殺す #NicoMiss'}),'blocked-word');
  rejected(note({user:{id:'user1',username:'tester',name:'殺してやる',host:null}}),'blocked-word');
  rejected(note({user:{id:'user1',username:'iwillkillyou',name:'無害な表示名',host:null}}),'blocked-word');
  rejected(note({text:'配信に表示しない秘密の単語 #NicoMiss'}),'blocked-word',{...settings,blockedWords:['秘密の単語']});
  expect(moderateMisskeyNote(note({text:'殺害予告に関する報道を確認しました #NicoMiss'}),settings,now).ok).toBe(true);
});

test('cheers, single-character laughter and short replies pass repetition moderation',()=>{
  for(const text of ['きた'+'あ'.repeat(60)+'！','w'.repeat(20),'ｗ'.repeat(40),'😀'.repeat(20),
    'はい'.repeat(20),'haha'.repeat(20),'わーい'.repeat(20),'そうです'.repeat(20),'abc'.repeat(20),'abcd'.repeat(20)]){
    expect(hasMechanicalRepetition(text)).toBe(false);
    expect(moderateMisskeyNote(note({text:text+' #NicoMiss'}),settings,now).ok).toBe(true);
  }
  expect(moderateMisskeyNote(note({user:{id:'user1',username:'tester',name:'w'.repeat(100),host:null}}),settings,now).ok).toBe(true);
  rejected(note({text:'きた'+'あ'.repeat(30)+'！殺してやる #NicoMiss'}),'blocked-word');
});

test('excessive phrase repetition is content-independent and still inspects author names',()=>{
  for(const phrase of ['加藤純一最強！','つぎの演目楽しみ！','ＡＢＣＤＥ！']){
    expect(moderateMisskeyNote(note({text:phrase+' #NicoMiss'}),settings,now).ok).toBe(true);
    rejected(note({text:phrase.repeat(6)+' #NicoMiss'}),'repetition');
  }
  rejected(note({user:{id:'user1',username:'tester',name:'加藤純一最強'.repeat(6),host:null}}),'repetition');
  expect(hasMechanicalRepetition('これは普段どおりの日本語の投稿です。読みやすい長さに整えます。')).toBe(false);
});

test('phrase repetition requires five copies, thirty graphemes, three kinds and sixty percent coverage',()=>{
  expect(hasMechanicalRepetition('abcde'.repeat(5))).toBe(false);
  expect(hasMechanicalRepetition('abcde'.repeat(6))).toBe(true);
  expect(hasMechanicalRepetition('abcdef'.repeat(4))).toBe(false);
  expect(hasMechanicalRepetition('abcdef'.repeat(5))).toBe(true);
  expect(hasMechanicalRepetition('ababa'.repeat(6))).toBe(false);
  expect(hasMechanicalRepetition('abaca'.repeat(6))).toBe(true);
  expect(hasMechanicalRepetition('abcdef'.repeat(5)+'z'.repeat(20))).toBe(true);
  expect(hasMechanicalRepetition('z'.repeat(20)+'abcdef'.repeat(5))).toBe(true);
  expect(hasMechanicalRepetition('z'.repeat(10)+'abcdef'.repeat(5)+'q'.repeat(10))).toBe(true);
  expect(hasMechanicalRepetition('abcdef'.repeat(5)+'z'.repeat(21))).toBe(false);
  expect(hasMechanicalRepetition('z'.repeat(21)+'abcdef'.repeat(5))).toBe(false);
  const sixtyFour=Array.from({length:64},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
  expect(hasMechanicalRepetition(sixtyFour.repeat(5))).toBe(true);
  expect(hasMechanicalRepetition((sixtyFour+'末').repeat(5))).toBe(false);
  expect(hasMechanicalRepetition(Array.from({length:6},(_,i)=>`abcde${i}`).join(''))).toBe(false);
});

test('phrase checks use normalized static MFM, tolerate punctuation changes and omit the watched tag',()=>{
  const varied=['**加藤純一最強！**','$[spin 加藤純一最強？]','[加藤純一最強](https://example.com)',
    '加 藤 純 一 最 強。','加\u200b藤純一最強','加藤純一最強‼'];
  rejected(note({text:varied.join('\n')+' #NicoMiss'}),'repetition');
  rejected(note({text:['ＡＢＣＤＥ！','abcde?','AbCdE。','ＡＢＣＤＥ','abcde','a b c d e'].join('\n')+' #NicoMiss'}),'repetition');
  const combined='か\u3099きくけこ';
  rejected(note({text:(combined+'！').repeat(6)+' #NicoMiss'}),'repetition');
  rejected(note({text:('👩🏽あいうえ').repeat(6)+' #NicoMiss'}),'repetition');
  expect(hasMechanicalRepetition('👩🏽あいう'.repeat(10))).toBe(false);
  // Without removing the monitored tag, 30 of these 58 normalized graphemes
  // would fall below 60%. Other commentary still counts in the denominator.
  rejected(note({text:'abcdef'.repeat(5)+'z'.repeat(20)+' #NicoMiss'}),'repetition');
});

test('repetition scans the full bounded body and retains malformed-grapheme protection',()=>{
  const prefix=Array.from({length:50},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
  rejected(note({text:prefix+'加藤純一最強！'.repeat(20)+' #NicoMiss'}),'repetition',{...settings,maxCharacters:40});
  const text='w'.repeat(15_990)+' #NicoMiss';
  expect(text).toHaveLength(16_000);
  const value=moderateMisskeyNote(note({text}),settings,now);
  expect(value.ok).toBe(true);if(value.ok)expect(value.note.truncated).toBe(true);
  rejected(note({text:'a'+'\u0301'.repeat(100)+' #NicoMiss'}),'repetition');
});

test('grapheme truncation preserves family emoji and combining marks and counts the ellipsis',()=>{
  const family='👨‍👩‍👧‍👦';
  expect(truncateGraphemes(family+'か\u3099'+'終わり',3)).toEqual({text:family+'か\u3099…',truncated:true});
  expect(truncateGraphemes(family+'か\u3099',2)).toEqual({text:family+'か\u3099',truncated:false});
  const text=Array.from({length:50},(_,i)=>`${i}番の場面について考えています`).join('。')+' #NicoMiss';
  const result=moderateMisskeyNote(note({text}),{...settings,maxCharacters:40},now);
  expect(result.ok).toBe(true);if(result.ok){expect(result.note.truncated).toBe(true);expect([...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(result.note.text)]).toHaveLength(40);}
});

test('invalid, too old, huge, empty and malformed metadata fail closed',()=>{
  rejected(null,'invalid');rejected(note({id:'../secret'}),'invalid');rejected(note({createdAt:'bad'}),'invalid');
  rejected(note({createdAt:new Date(now+60_001).toISOString()}),'invalid');
  rejected(note({createdAt:new Date(now-120_001).toISOString()}),'too-old');
  rejected(note({text:'x'.repeat(16_001)}),'invalid');rejected(note({text:null}),'empty');
  rejected(note({text:' \n\t '}),'empty');rejected(note({text:42}),'invalid');
  rejected(note({user:{id:'user1',username:'tester',name:'x'.repeat(257),host:null}}),'invalid');
  rejected(note({files:Array(65).fill({})}),'invalid');
});

test('content fingerprints normalize case, compatible width, punctuation and invisible separators',()=>{
  const a=moderateMisskeyNote(note({text:'ＨＥＬＬＯ！ #NicoMiss'}),settings,now);
  const b=moderateMisskeyNote(note({text:'he\u200bllo #nicomiss'}),settings,now);
  expect(a.ok&&b.ok).toBe(true);if(a.ok&&b.ok)expect(a.fingerprint).toBe(b.fingerprint);
});
