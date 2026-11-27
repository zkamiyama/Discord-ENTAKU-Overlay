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

test('mechanical repetition catches long runs and repeated short blocks without flagging ordinary text',()=>{
  for(const text of ['あ'.repeat(12),'abc'.repeat(10),'宣伝広告'.repeat(8)]){
    expect(hasMechanicalRepetition(text)).toBe(true);rejected(note({text:text+' #NicoMiss'}),'repetition');
  }
  expect(hasMechanicalRepetition('これは普段どおりの日本語の投稿です。読みやすい長さに整えます。')).toBe(false);
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
