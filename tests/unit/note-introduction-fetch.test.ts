import {expect,test} from 'bun:test';
import type {NoteIntroductionSettings} from '../../src/contracts/note-introduction.ts';
import {DEFAULT_NOTE_INTRODUCTION_SETTINGS,validateNoteIntroductionSettings} from '../../src/note-introduction/settings.ts';
import {fetchIntroducedNote,lastNoteTarget,normalizeIntroducedNote,NoteIntroductionFailure,NOTE_INTRODUCTION_FETCH_LIMITS,type NoteIntroductionDependencies,type NoteTarget} from '../../src/note-introduction/fetch-note.ts';
import {staticMfmText} from '../../src/misskey/moderation.ts';

const BASE=1_800_000_000_000;
const settings=():NoteIntroductionSettings=>({schemaVersion:1,enabled:true,instances:['https://otomad.site'],includeHome:false});
const target=(id='note1'):NoteTarget=>({id,instanceUrl:'https://otomad.site',url:`https://otomad.site/notes/${id}`});
const note=(overrides:Record<string,unknown>={})=>({id:'note1',createdAt:'2001-01-01T00:00:00.000Z',visibility:'public',text:'**Synthetic** note',
  user:{id:'user1',username:'test_user',name:'投稿者',host:null},files:[],...overrides});
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
class Clock {
  now=BASE;next=1;timers=new Map<number,{at:number;run:()=>void}>();
  setTimeout=(run:()=>void,delay:number)=>{const id=this.next++;this.timers.set(id,{at:this.now+delay,run});return id;};
  clearTimeout=(id:unknown)=>{this.timers.delete(id as number);};
  async advance(ms:number):Promise<void>{const end=this.now+ms;await flush();for(let i=0;i<10_000;i++){
    const first=[...this.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
    if(!first){this.now=end;await flush();return;}this.now=first[1].at;this.timers.delete(first[0]);first[1].run();await flush();
  }throw Error('timer loop');}
}
function network(reply:()=>Response|Promise<Response>=()=>Response.json(note())) {
  const clock=new Clock(),calls:Array<{url:string;options:RequestInit}>=[];
  const deps:NoteIntroductionDependencies={now:()=>clock.now,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
    fetch:(async(url:string|URL|Request,options?:RequestInit)=>{calls.push({url:String(url),options:options!});return await reply();}) as typeof fetch};
  return {clock,calls,deps};
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const get=(f:ReturnType<typeof network>,signal=new AbortController().signal)=>fetchIntroducedNote(target(),settings(),signal,f.deps);
const failure=async(p:Promise<unknown>):Promise<NoteIntroductionFailure>=>{try{await p;throw Error('expected rejection');}catch(error){expect(error).toBeInstanceOf(NoteIntroductionFailure);return error as NoteIntroductionFailure;}};

test('note introduction settings are pure, detached and contain only bounded public HTTPS origins',()=>{
  expect(DEFAULT_NOTE_INTRODUCTION_SETTINGS).toEqual(settings());
  const input={...settings(),instances:[' HTTPS://OTOMAD.SITE/ ','https://misskey.io']};const clean=validateNoteIntroductionSettings(input);
  expect(clean.instances).toEqual(['https://otomad.site','https://misskey.io']);input.instances[0]='changed';expect(clean.instances[0]).toBe('https://otomad.site');
  expect(validateNoteIntroductionSettings({...settings(),enabled:false,instances:[]})).toMatchObject({enabled:false,instances:[]});
  for(const bad of [null,[],{...settings(),schemaVersion:2},{...settings(),token:'secret'},{...settings(),enabled:'yes'},
    {...settings(),instances:[]},{...settings(),includeHome:1},{...settings(),instances:Array.from({length:9},(_,i)=>`https://s${i}.example.org`)},
    {...settings(),instances:['https://otomad.site','https://OTOMAD.SITE/']},
    ...['http://otomad.site','https://user:pass@otomad.site','https://otomad.site:443','https://otomad.site/path','https://127.0.0.1','https://localhost','https://server.local'].map(origin=>({...settings(),instances:[origin]}))])
    expect(()=>validateNoteIntroductionSettings(bad)).toThrow('NOTE_INTRODUCTION_SETTINGS_INVALID');
});

test('extracts the last eligible note URL from Discord brackets and Japanese punctuation',()=>{
  expect(lastNoteTarget('まず <https://otomad.site/notes/old>、次は [こちら](https://otomad.site/notes/NEW_2-3)。 https://example.org/notes/ignored',settings().instances)).toEqual(target('NEW_2-3'));
  expect(lastNoteTarget('「https://otomad.site/notes/n1」、 https://otomad.site/notes/n2！',settings().instances)).toEqual(target('n2'));
  expect(lastNoteTarget('https://misskey.io/notes/abc',['https://otomad.site','https://misskey.io'])).toEqual({id:'abc',url:'https://misskey.io/notes/abc',instanceUrl:'https://misskey.io'});
  expect(lastNoteTarget('URLはなし',settings().instances)).toBeNull();
});

test('does not normalize an untrusted URL into an eligible note or follow its query, userinfo or port',()=>{
  for(const url of ['http://otomad.site/notes/n1','https://otomad.site.evil.example/notes/n1','https://otomad.site@evil.example/notes/n1',
    'https://evil.example@otomad.site/notes/n1','https://otomad.site:443/notes/n1','https://%6ftomad.site/notes/n1',
    'https://otomad.site\\@evil.example/notes/n1','https://otomad.site/notes/n1?x=1','https://otomad.site/notes/n1#x',
    'https://otomad.site/notes/n1/','https://otomad.site/@user/n1','https://otomad.site/a/../notes/n1','https://otomad.site/%2e/notes/n1',
    'https://otomad.site/notes/%6e1','https://otomad.site/notes/'+ 'a'.repeat(129)])
    expect(lastNoteTarget(url,settings().instances)).toBeNull();
});

test('keeps the complete static body and whitespace without hashtag, age, repetition or local-author gates',()=>{
  const body='\n\t**全文**\n\n\n'+ '長い本文'.repeat(1500)+'\n';
  const result=normalizeIntroducedNote(note({text:body,user:{id:'remote1',username:'remote_user',name:'  $[x2 名前]  ',host:'remote.example.org'}}),target(),settings());
  expect(result.text).toBe('\n\t全文\n\n\n'+'長い本文'.repeat(1500)+'\n');expect(result.userHost).toBe('remote.example.org');expect(result.authorName).toBe('名前');
  expect(result.text.length).toBeGreaterThan(400);expect(result.createdAt).toBe('2001-01-01T00:00:00.000Z');
  expect(staticMfmText('\n\t本文\n\n\n')).toBe('本文');
  expect(staticMfmText('\r\n\t本文\u202e\n\n\n',{preserveWhitespace:true})).toBe('\n\t本文\n\n\n');
  expect(normalizeIntroducedNote(note({text:'同じフレーズ！'.repeat(8)}),target(),settings()).text).toBe('同じフレーズ！'.repeat(8));
});

test('rejects nonpublic, concealed and sensitive posts including files, channel and quoted content',()=>{
  for(const overrides of [{visibility:'home'},{visibility:'followers'},{visibility:'specified'},{isHidden:true},{hidden:true},{visibleUserIds:['u']},
    {user:{id:'u',username:'u',requireSigninToViewContents:true}},{user:{id:'u',username:'u',isSuspended:true}}])
    expect(()=>normalizeIntroducedNote(note(overrides),target(),settings())).toThrow('NOTE_INTRODUCTION_NOT_PUBLIC');
  expect(normalizeIntroducedNote(note({visibility:'home'}),target(),{...settings(),includeHome:true}).id).toBe('note1');
  for(const overrides of [{cw:''},{cw:'CW'},{isSensitive:true},{sensitive:true},{channel:{isSensitive:true}},{files:[{isSensitive:true}]},
    {renote:note({id:'quoted',cw:'hidden'})}])expect(()=>normalizeIntroducedNote(note(overrides),target(),settings())).toThrow('NOTE_INTRODUCTION_SENSITIVE');
});

test('poll, quote and attachment metadata are text only; malformed or over-budget note bodies fail closed',()=>{
  const result=normalizeIntroducedNote(note({text:'',files:[{url:'https://private.invalid/image.png'}],poll:{choices:[{text:'**A**'},{text:'B'}]},
    renote:note({id:'quoted',text:'引用本文',files:[{url:'https://private.invalid/other.png'}]})}),target(),settings());
  expect(result.text).toBe('アンケート\n1. A\n2. B\n\n引用：投稿者\n引用本文\n添付 1件');expect(result.attachmentCount).toBe(1);expect(JSON.stringify(result)).not.toContain('private.invalid');
  expect(normalizeIntroducedNote(note({text:null,files:[{}]}),target(),settings()).text).toBe('');
  for(const overrides of [{id:'wrong'},{createdAt:'invalid'},{isHidden:'false'},{user:{id:'u',username:'<img>'}},
    {user:{id:'u',username:'u',name:'x'.repeat(513)}},{files:[{isSensitive:'false'}]},{text:'x'.repeat(16_001)},
    {poll:{choices:[{text:'x'.repeat(16_000)},{text:'y'.repeat(16_000)},{text:'z'.repeat(16_000)}]}},
    {renote:note({id:'q',renote:note({id:'q2'})})}])expect(()=>normalizeIntroducedNote(note(overrides),target(),settings())).toThrow('NOTE_INTRODUCTION_INVALID_NOTE');
  expect(()=>normalizeIntroducedNote(note({text:' \n\t '}),target(),settings())).toThrow('NOTE_INTRODUCTION_EMPTY');
});

test('fetches exactly one anonymous canonical POST with no redirect, cookie, cache or attachment request',async()=>{
  const f=network(()=>Response.json(note({files:[{url:'https://private.invalid/video.mp4'}]})));const result=await get(f);
  expect(f.calls).toHaveLength(1);expect(f.calls[0]?.url).toBe('https://otomad.site/api/notes/show');
  expect(f.calls[0]?.options).toMatchObject({method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:'{"noteId":"note1"}',redirect:'error',credentials:'omit',cache:'no-store'});
  expect(result.attachmentCount).toBe(1);expect(f.clock.timers.size).toBe(0);
  const denied=await failure(fetchIntroducedNote({...target(),instanceUrl:'https://evil.example'},settings(),new AbortController().signal,f.deps));
  expect(denied.code).toBe('NOTE_INTRODUCTION_INVALID_NOTE');expect(f.calls).toHaveLength(1);
});

test('validates response headers, actual streamed bytes, UTF-8 and JSON before exposing note data',async()=>{
  for(const [reply,code] of [
    [()=>new Response('{}',{headers:{'Content-Type':'text/html'}}),'INVALID_NOTE'],
    [()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'invalid'}}),'INVALID_NOTE'],
    [()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(NOTE_INTRODUCTION_FETCH_LIMITS.responseBytes+1)}}),'RESPONSE_TOO_LARGE'],
    [()=>new Response('x'.repeat(NOTE_INTRODUCTION_FETCH_LIMITS.responseBytes+1),{headers:{'Content-Type':'application/json'}}),'RESPONSE_TOO_LARGE'],
    [()=>new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}}),'INVALID_NOTE'],
    [()=>new Response('{',{headers:{'Content-Type':'application/json'}}),'INVALID_NOTE'],
  ] as const){const f=network(reply);expect((await failure(get(f))).code).toBe(`NOTE_INTRODUCTION_${code}`);expect(f.clock.timers.size).toBe(0);}
});

test('maps provider failures to stable public error codes without copying raw provider details',async()=>{
  for(const [response,code] of [[new Response(null,{status:404}),'NOT_FOUND'],[new Response(null,{status:403}),'NOT_PUBLIC'],
    [Response.json({error:{code:'CONTENT_RESTRICTED_BY_USER',message:'SECRET'}},{status:400}),'NOT_PUBLIC'],
    [Response.json({error:{code:'NO_SUCH_NOTE',message:'SECRET'}},{status:400}),'NOT_FOUND'],
    [new Response('SECRET',{status:503}),'UNAVAILABLE']] as const){const error=await failure(get(network(()=>response)));expect(error.code).toBe(`NOTE_INTRODUCTION_${code}`);expect(error.message).not.toContain('SECRET');}
});

test('deadline covers an indefinitely streaming body and releases the stream',async()=>{
  let cancelled=0;const f=network(()=>new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;}}),{headers:{'Content-Type':'application/json'}}));
  const result=failure(get(f));await f.clock.advance(10_000);expect((await result).code).toBe('NOTE_INTRODUCTION_TIMEOUT');expect(cancelled).toBe(1);expect(f.clock.timers.size).toBe(0);
});

test('abort settles promptly and cancels a late response even if the transport ignores its signal',async()=>{
  const late=deferred<Response>(),f=network(()=>late.promise),controller=new AbortController();let cancelled=0;
  const result=failure(get(f,controller.signal));controller.abort();await flush();expect((await result).code).toBe('NOTE_INTRODUCTION_UNAVAILABLE');
  late.resolve(new Response(new ReadableStream<Uint8Array>({cancel(){cancelled++;}}),{headers:{'Content-Type':'application/json'}}));
  await flush();expect(cancelled).toBe(1);expect(f.clock.timers.size).toBe(0);
});

test('timeout settles even without a fetch response and also cancels a later body',async()=>{
  const late=deferred<Response>(),f=network(()=>late.promise);let cancelled=0;const result=failure(get(f));
  await f.clock.advance(10_000);expect((await result).code).toBe('NOTE_INTRODUCTION_TIMEOUT');
  late.resolve(new Response(new ReadableStream<Uint8Array>({cancel(){cancelled++;}})));await flush();expect(cancelled).toBe(1);
});

test('Retry-After keeps seconds and HTTP dates, defaults safely and never shortens a long server wait',async()=>{
  for(const [header,delay] of [['90',90_000],[new Date(BASE+45_000).toUTCString(),45_000],['7200',7_200_000],['invalid',60_000],['0',1000]] as const){
    const f=network(()=>new Response(null,{status:429,headers:{'Retry-After':header}}));const error=await failure(get(f));
    expect(error.code).toBe('NOTE_INTRODUCTION_RATE_LIMITED');expect(error.retryAt).toBe(BASE+delay);
  }
});
