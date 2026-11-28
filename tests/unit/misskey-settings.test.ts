import {expect,test} from 'bun:test';
import {DEFAULT_MISSKEY_SETTINGS,normalizeMisskeyInstance,validateMisskeySettings} from '../../src/misskey/settings.ts';

test('Misskey defaults are public, local, disabled and bounded; input normalization retains hashtag case',()=>{
  expect(validateMisskeySettings(DEFAULT_MISSKEY_SETTINGS)).toMatchObject({
    enabled:false,instanceUrl:'https://otomad.site',hashtag:'NicoMiss',localOnly:true,includeHome:false,
    maxCards:30,maxPerUser:1,lifetimeMs:45_000,maxCharacters:180,
  });
  const value=validateMisskeySettings({...DEFAULT_MISSKEY_SETTINGS,instanceUrl:' HTTPS://OTOMAD.SITE/ ',hashtag:' #NicoMiss ',blockedWords:['禁止','禁止'],blockedUsers:['user-1','user-1']});
  expect(value.instanceUrl).toBe('https://otomad.site');expect(value.hashtag).toBe('NicoMiss');
  expect(value.blockedWords).toEqual(['禁止']);expect(value.blockedUsers).toEqual(['user-1']);
});

test('Misskey instance rejects credentials, explicit ports, paths, local addresses and ambiguous URL spelling',()=>{
  const bad=[
    'http://otomad.site','https://user:secret@otomad.site','https://otomad.site:443','https://otomad.site:8443',
    'https://otomad.site/path','https://otomad.site/a/..','https://otomad.site?x=1','https://otomad.site#tag',
    'https://127.0.0.1','https://10.1.2.3','https://192.168.0.1','https://[::1]','https://2130706433',
    'https://0x7f000001','https://localhost','https://x.localhost','https://x.local','https://x.internal',
    'https://home.arpa','https://x.home.arpa','https://example.test','https://otomad.site.','https://-bad.example',
    'https://otomad.site\\@127.0.0.1','https://%6ftomad.site',
  ];
  for(const url of bad)expect(()=>normalizeMisskeyInstance(url)).toThrow('MISSKEY_SETTINGS_INVALID');
  expect(normalizeMisskeyInstance('https://misskey.example.com')).toBe('https://misskey.example.com');
});

test('Misskey settings reject missing fields, unknown keys, wrong types, and all documented limits',()=>{
  for(const patch of [
    {enabled:1},{localOnly:'true'},{includeHome:undefined},{extra:true},{maxCards:0},{maxCards:31},
    {maxPerUser:0},{maxPerUser:4},{lifetimeMs:4999},{lifetimeMs:120001},{maxCharacters:39},{maxCharacters:401},
    {maxCards:1.5},{maxCards:NaN},{hashtag:''},{hashtag:'two tags'},{hashtag:'x\u200by'},{hashtag:'a'.repeat(129)},
    {blockedWords:['']},{blockedWords:['a'.repeat(65)]},{blockedWords:Array(129).fill('x')},{blockedWords:['x\ny']},
    {blockedUsers:['@someone']},{blockedUsers:Array(257).fill('1')},{blockedUsers:['a'.repeat(129)]},
  ])expect(()=>validateMisskeySettings({...DEFAULT_MISSKEY_SETTINGS,...patch})).toThrow('MISSKEY_SETTINGS_INVALID');
  for(const value of [null,[],{},false])expect(()=>validateMisskeySettings(value)).toThrow('MISSKEY_SETTINGS_INVALID');
});

test('validated lists are independent from caller mutations',()=>{
  const input={...DEFAULT_MISSKEY_SETTINGS,blockedWords:['禁止'],blockedUsers:['user1']};
  const output=validateMisskeySettings(input);input.blockedWords.push('あとから');input.blockedUsers.length=0;
  expect(output.blockedWords).toEqual(['禁止']);expect(output.blockedUsers).toEqual(['user1']);
});
