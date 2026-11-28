import {expect,test} from 'bun:test';
import type {NoteIntroductionSettings} from '../../src/contracts/note-introduction.ts';
import {parseNoteIntroductionState} from '../../src/contracts/note-introduction.ts';
import type {VcChatMessage} from '../../src/contracts/vc-chat.ts';
import {NoteIntroductionFeed,type NoteIntroductionDependencies} from '../../src/note-introduction/feed.ts';

const BASE=1_800_000_000_000;
const settings=():NoteIntroductionSettings=>({schemaVersion:1,enabled:true,instances:['https://otomad.site'],includeHome:false});
const url=(id:string)=>`https://otomad.site/notes/${id}`;
const note=(id:string,text=`Synthetic ${id}`)=>({id,text,visibility:'public',createdAt:'2000-01-01T00:00:00.000Z',user:{id:'user1',username:'synthetic',name:'投稿者',host:null},files:[]});
const message=(id:string,content=url(`note${id}`),authorName='紹介者'):VcChatMessage=>({id,channelId:'200',authorId:'42',authorName,content,timestamp:new Date(BASE).toISOString(),editedTimestamp:null,attachmentCount:0,truncated:false});
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
type Reply=(id:string)=>Response|Promise<Response>;
function setup(replies:Reply[]=[],configuration=settings()) {
  const clock=new Clock(),calls:Array<{id:string;at:number;signal:AbortSignal}>=[];
  const deps:NoteIntroductionDependencies={now:()=>clock.now,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
    fetch:(async(_url:string|URL|Request,options?:RequestInit)=>{const id=(JSON.parse(options!.body as string) as {noteId:string}).noteId;
      calls.push({id,at:clock.now,signal:options!.signal!});return await (replies.shift()?.(id)??Response.json(note(id)));}) as typeof fetch};
  const feed=new NoteIntroductionFeed(configuration,deps),states:unknown[]=[];feed.observe(state=>{states.push(state);expect(parseNoteIntroductionState(state)).not.toBeNull();});
  const create=(id:string,content?:string,name?:string)=>feed.accept({type:'create',message:message(id,content,name)});
  return {clock,feed,calls,states,create,replies};
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

test('one newest pending URL replaces cancelled work and starts at most once per second',async()=>{
  const first=deferred<Response>(),f=setup([()=>first.promise]);f.create('1');expect(f.feed.snapshot()).toMatchObject({status:'loading',pendingUrl:url('note1'),card:null});
  f.create('2');f.create('3');expect(f.calls).toHaveLength(1);expect(f.calls[0]?.signal.aborted).toBe(true);
  await f.clock.advance(999);expect(f.calls).toHaveLength(1);await f.clock.advance(1);
  expect(f.calls.map(c=>c.id)).toEqual(['note1','note3']);expect(f.calls[1]!.at-f.calls[0]!.at).toBe(1000);
  expect(f.feed.snapshot()).toMatchObject({status:'showing',card:{id:'note3',sourceMessageId:'3',presentationId:1},pendingUrl:null});
  first.resolve(Response.json(note('note1')));await flush();expect(f.feed.snapshot().card?.id).toBe('note3');f.feed.dispose();expect(f.clock.timers.size).toBe(0);
});

test('failed replacement keeps the prior card and an unrelated message cannot revive or re-fetch it',async()=>{
  const f=setup();f.create('1');await flush();f.replies.push(()=>new Response(null,{status:404}));f.create('2');
  expect(f.feed.snapshot()).toMatchObject({status:'loading',card:{id:'note1'},pendingUrl:url('note2')});await f.clock.advance(1000);
  expect(f.feed.snapshot()).toMatchObject({status:'error',card:{id:'note1'},pendingUrl:null,errorCode:'NOTE_INTRODUCTION_NOT_FOUND'});
  f.feed.accept({type:'update',message:message('1',url('note1')+' 追記')});f.create('3','普通の会話');await f.clock.advance(1000);
  expect(f.calls).toHaveLength(2);expect(f.feed.snapshot().card?.id).toBe('note1');f.feed.dispose();
});

test('a new source message with the same URL fetches fresh note content and gets a new presentation',async()=>{
  const f=setup();f.create('1',url('same'),'最初の人');await flush();
  f.feed.accept({type:'update',message:message('1',url('same')+' 注記','名前更新')});await f.clock.advance(1000);expect(f.calls).toHaveLength(1);
  f.replies.push(()=>Response.json(note('same','編集後の本文')));f.create('2',url('same'),'次の人');await flush();
  expect(f.calls).toHaveLength(2);expect(f.feed.snapshot().card).toMatchObject({id:'same',text:'編集後の本文',introducedBy:'次の人',sourceMessageId:'2',presentationId:2});
  f.feed.dispose();
});

test('the latest sharer of the same pending URL replaces source metadata without duplicate requests',async()=>{
  const result=deferred<Response>(),f=setup([()=>result.promise]);f.create('1',url('same'),'最初の人');f.create('2',url('same'),'次の人');
  expect(f.calls).toHaveLength(1);result.resolve(Response.json(note('same')));await flush();
  expect(f.feed.snapshot().card).toMatchObject({id:'same',sourceMessageId:'2',introducedBy:'次の人',presentationId:1});f.feed.dispose();
});

test('dismiss clears both card and pending reservation and late HTTP or metadata updates cannot revive either',async()=>{
  const late=deferred<Response>(),f=setup();f.create('1');await flush();f.replies.push(()=>late.promise);f.create('2');await f.clock.advance(1000);
  f.feed.dismiss();expect(f.feed.snapshot()).toMatchObject({status:'idle',card:null,pendingUrl:null});expect(f.calls[1]?.signal.aborted).toBe(true);
  late.resolve(Response.json(note('note2')));await flush();f.feed.accept({type:'update',message:message('1',url('note1')+' 補足')});
  f.feed.accept({type:'update',message:message('2',url('note2')+' 補足')});await f.clock.advance(2000);
  expect(f.calls).toHaveLength(2);expect(f.feed.snapshot().card).toBeNull();f.feed.dispose();
});

test('an unknown old full update after bounded history eviction establishes a baseline without reopening a dismissed card',async()=>{
  const f=setup();f.create('1');await flush();f.feed.dismiss();for(let id=2;id<=1003;id++)f.create(String(id),'普通の会話');
  f.feed.accept({type:'update',message:message('1',url('note1')+' 補足')});await f.clock.advance(1000);
  expect(f.calls).toHaveLength(1);expect(f.feed.snapshot().card).toBeNull();
  f.feed.accept({type:'update',message:message('1',url('changed'))});await flush();expect(f.feed.snapshot().card?.id).toBe('changed');
  f.feed.dispose();
});

test('retained source metadata makes an evicted partial update safe and does not overwrite the newly fetched note',async()=>{
  const f=setup();f.create('1');await flush();for(let id=2;id<=1003;id++)f.create(String(id),'普通の会話');
  f.feed.accept({type:'invalidate',messageId:'1',channelId:'200',content:url('note1')+' 注記'});await f.clock.advance(1000);expect(f.calls).toHaveLength(1);
  f.feed.accept({type:'invalidate',messageId:'1',channelId:'200',content:url('edited')});await flush();
  expect(f.feed.snapshot().card).toMatchObject({id:'edited',url:url('edited'),text:'Synthetic edited',sourceMessageId:'1',introducedBy:'紹介者',presentationId:2});
  f.feed.accept({type:'invalidate',messageId:'1',channelId:'200',content:'URLを除去'});expect(f.feed.snapshot()).toMatchObject({status:'idle',card:null});
  f.feed.accept({type:'invalidate',messageId:'1',channelId:'200',content:url('revive')});await f.clock.advance(1000);expect(f.calls).toHaveLength(2);f.feed.dispose();
});

test('same-URL partial edit of the old source does not cancel another pending introduction',async()=>{
  const late=deferred<Response>(),f=setup();f.create('1');await flush();f.replies.push(()=>late.promise);f.create('2');await f.clock.advance(1000);
  f.feed.accept({type:'invalidate',messageId:'1',channelId:'200',content:url('note1')+' 補足'});expect(f.calls[1]?.signal.aborted).toBe(false);
  late.resolve(Response.json(note('note2')));await flush();expect(f.feed.snapshot().card?.id).toBe('note2');f.feed.dispose();
});

test('unknown partial changes are inert; removal or blocking of the current source withdraws its card and pending result',async()=>{
  const f=setup();f.feed.accept({type:'invalidate',messageId:'9',channelId:'200',content:url('ignored')});expect(f.calls).toHaveLength(0);
  f.create('1');await flush();const late=deferred<Response>();f.replies.push(()=>late.promise);f.feed.accept({type:'update',message:message('1',url('updated'))});await f.clock.advance(1000);
  f.feed.accept({type:'delete',messageId:'1',channelId:'200'});expect(f.feed.snapshot()).toMatchObject({status:'idle',card:null,pendingUrl:null});
  late.resolve(Response.json(note('updated')));await flush();f.create('1',url('duplicate'));await f.clock.advance(1000);expect(f.calls).toHaveLength(2);f.feed.dispose();
});

test('deleting the old card preserves a different pending source, and deleting just the pending source restores the old card',async()=>{
  const f=setup();f.create('1');await flush();f.create('2');f.feed.accept({type:'delete',messageId:'2',channelId:'200'});
  expect(f.feed.snapshot()).toMatchObject({status:'showing',card:{id:'note1'},pendingUrl:null});
  f.create('3');f.feed.accept({type:'delete',messageId:'1',channelId:'200'});expect(f.feed.snapshot()).toMatchObject({status:'loading',card:null,pendingUrl:url('note3')});
  await f.clock.advance(1000);expect(f.feed.snapshot().card?.id).toBe('note3');f.feed.dispose();
});

test('reset, setting changes and dispose invalidate all outstanding work and maintain isolated snapshot copies',async()=>{
  for(const stop of ['reset','configure','dispose'] as const){
    const late=deferred<Response>(),f=setup([()=>late.promise]);f.create('1');
    if(stop==='reset')f.feed.accept({type:'reset'});else if(stop==='configure')f.feed.configure({...settings(),enabled:false});else f.feed.dispose();
    late.resolve(Response.json(note('note1')));await flush();expect(f.feed.snapshot().card).toBeNull();expect(f.clock.timers.size).toBe(0);expect(f.calls[0]?.signal.aborted).toBe(true);f.feed.dispose();
  }
  const f=setup();f.feed.observe(()=>{throw Error('SECRET');});f.create('1');await flush();
  const view=f.feed.snapshot();view.card!.text='mutated';const config=f.feed.settings;config.instances[0]='https://evil.example';
  expect(f.feed.snapshot().card?.text).toBe('Synthetic note1');expect(f.feed.settings.instances).toEqual(['https://otomad.site']);f.feed.dispose();
});

test('disabled configuration performs no request; enabling does not replay old messages',async()=>{
  const f=setup([],{...settings(),enabled:false});f.create('1');expect(f.calls).toHaveLength(0);expect(f.feed.snapshot().status).toBe('disabled');
  f.feed.configure(settings());await f.clock.advance(1000);expect(f.calls).toHaveLength(0);f.create('2');await flush();expect(f.feed.snapshot().card?.id).toBe('note2');f.feed.dispose();
});

test('429 cooldown survives replacement, retries only the newest URL and has a finite automatic retry budget',async()=>{
  const f=setup([()=>new Response(null,{status:429,headers:{'Retry-After':'5'}})]);f.create('1');await flush();
  expect(f.feed.snapshot()).toMatchObject({status:'error',pendingUrl:url('note1'),retryAt:BASE+5000,errorCode:'NOTE_INTRODUCTION_RATE_LIMITED'});
  f.create('2');await f.clock.advance(4999);expect(f.calls).toHaveLength(1);await f.clock.advance(1);expect(f.calls.map(c=>c.id)).toEqual(['note1','note2']);
  expect(f.feed.snapshot().card?.id).toBe('note2');f.feed.dispose();
  const throttled=setup([()=>new Response(null,{status:429,headers:{'Retry-After':'1'}}),()=>new Response(null,{status:429,headers:{'Retry-After':'1'}})]);
  throttled.create('1');await throttled.clock.advance(30_000);expect(throttled.calls).toHaveLength(2);expect(throttled.clock.timers.size).toBe(0);
  expect(throttled.feed.snapshot()).toMatchObject({status:'error',pendingUrl:null,errorCode:'NOTE_INTRODUCTION_RATE_LIMITED'});throttled.feed.dispose();
});

test('a long Retry-After is not retried early, including after a newer URL or settings reset',async()=>{
  const f=setup([()=>new Response(null,{status:429,headers:{'Retry-After':'7200'}})]);f.create('1');await flush();
  expect(f.feed.snapshot()).toMatchObject({status:'error',pendingUrl:null,retryAt:BASE+7_200_000});expect(f.clock.timers.size).toBe(0);
  f.feed.configure({...settings(),includeHome:true});f.create('2');await f.clock.advance(7_199_999);expect(f.calls).toHaveLength(1);
  await f.clock.advance(1);expect(f.calls.map(c=>c.id)).toEqual(['note1','note2']);expect(f.feed.snapshot().card?.id).toBe('note2');f.feed.dispose();
});

test('dismiss cancels a scheduled retry and the same source metadata cannot restart the network request',async()=>{
  const f=setup([()=>new Response(null,{status:429,headers:{'Retry-After':'1'}})]);f.create('1');await flush();f.feed.dismiss();
  f.feed.accept({type:'update',message:message('1',url('note1')+' 補足')});await f.clock.advance(10_000);
  expect(f.calls).toHaveLength(1);expect(f.feed.snapshot()).toMatchObject({status:'idle',card:null,pendingUrl:null});f.feed.dispose();
});
