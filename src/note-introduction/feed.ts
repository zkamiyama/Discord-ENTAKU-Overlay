import {emptyNoteIntroduction,type NoteIntroductionSettings,type NoteIntroductionState} from '../contracts/note-introduction.ts';
import type {ChatChange,VcChatMessage} from '../contracts/vc-chat.ts';
import {fetchIntroducedNote,lastNoteTarget,NoteIntroductionFailure,NOTE_INTRODUCTION_FETCH_LIMITS,type NoteTarget,type NoteIntroductionDependencies} from './fetch-note.ts';
import {validateNoteIntroductionSettings} from './settings.ts';
export type {NoteIntroductionDependencies} from './fetch-note.ts';

interface Source {sourceMessageId:string;sourceChannelId:string;introducedBy:string}
interface Pending {target:NoteTarget;source:Source;generation:number;attempts:number}
const sourceKey=(channelId:string,messageId:string)=>`${channelId}:${messageId}`;
const sameSource=(source:Source,channelId:string,messageId:string)=>source.sourceChannelId===channelId&&source.sourceMessageId===messageId;
const copySource=(source:Source):Source=>({sourceMessageId:source.sourceMessageId,sourceChannelId:source.sourceChannelId,introducedBy:source.introducedBy});
const validId=(value:unknown):value is string=>typeof value==='string'&&/^\d{1,20}$/.test(value);
const defaults:NoteIntroductionDependencies={fetch:globalThis.fetch,now:Date.now,
  setTimeout:(callback,delay)=>setTimeout(callback,delay),clearTimeout:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};

/** One card and one replaceable reservation. Provider history, arbitrary chat
 * edits and cancelled HTTP results cannot turn a dismissed card back on. */
export class NoteIntroductionFeed {
  private configuration:NoteIntroductionSettings;
  private state:NoteIntroductionState;
  private readonly deps:NoteIntroductionDependencies;
  private listeners=new Set<(state:NoteIntroductionState)=>void>();
  private seen=new Map<string,string|null>();
  private deleted=new Set<string>();
  private pending:Pending|null=null;
  private controller:AbortController|null=null;
  private timer:unknown=null;
  private generation=0;
  private presentation=0;
  private nextRequestAt=0;
  private cooldowns=new Map<string,number>();
  private stopped=false;
  constructor(settings:NoteIntroductionSettings,deps:Partial<NoteIntroductionDependencies>={}) {
    this.configuration=validateNoteIntroductionSettings(settings);this.state=emptyNoteIntroduction(this.configuration.enabled);this.deps={...defaults,...deps};
  }
  get settings():NoteIntroductionSettings{return structuredClone(this.configuration);}
  snapshot():NoteIntroductionState{return structuredClone(this.state);}
  observe(listener:(state:NoteIntroductionState)=>void):()=>void {this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private publish():void {
    this.state.revision++;for(const listener of this.listeners)try{listener(this.snapshot());}catch{/* A display cannot interrupt Discord or the HTTP lifecycle. */}
  }
  private cancel():void {
    this.generation++;if(this.timer!==null)this.deps.clearTimeout(this.timer);this.timer=null;
    this.controller?.abort();this.controller=null;this.pending=null;
  }
  private clear(forget:boolean):void {
    this.cancel();if(forget){this.seen.clear();this.deleted.clear();}
    const revision=this.state.revision;this.state={...emptyNoteIntroduction(this.configuration.enabled),revision};this.publish();
  }
  configure(settings:NoteIntroductionSettings):void {
    if(this.stopped)return;const clean=validateNoteIntroductionSettings(settings);
    if(JSON.stringify(clean)===JSON.stringify(this.configuration))return;
    this.configuration=clean;this.clear(false);
    for(const [origin,until] of this.cooldowns)if(until<=this.deps.now())this.cooldowns.delete(origin);
  }
  dismiss():void {if(!this.stopped)this.clear(false);}
  dispose():void {
    if(this.stopped)return;this.stopped=true;this.cancel();this.seen.clear();this.deleted.clear();this.cooldowns.clear();this.listeners.clear();
    this.state={...emptyNoteIntroduction(false),revision:this.state.revision+1};
  }
  private remember(key:string,url:string|null):void {
    this.seen.delete(key);this.seen.set(key,url);if(this.seen.size>1000)this.seen.delete(this.seen.keys().next().value!);
  }
  private source(message:VcChatMessage):Source|null {
    if(!message||!validId(message.id)||!validId(message.channelId)||typeof message.authorName!=='string'||message.authorName.length>100||
      typeof message.content!=='string'||message.content.length>4000)return null;
    return {sourceMessageId:message.id,sourceChannelId:message.channelId,introducedBy:message.authorName};
  }
  accept(change:ChatChange):void {
    if(this.stopped)return;
    if(change.type==='reset'){this.clear(true);return;}
    if(!this.configuration.enabled)return;
    if(change.type==='delete'){
      if(!validId(change.channelId)||!validId(change.messageId))return;
      const key=sourceKey(change.channelId,change.messageId);this.deleted.add(key);if(this.deleted.size>1000)this.deleted.delete(this.deleted.values().next().value!);
      this.removeSource(change.channelId,change.messageId);return;
    }
    if(change.type==='invalidate'){
      if(!validId(change.channelId)||!validId(change.messageId))return;
      const key=sourceKey(change.channelId,change.messageId);if(this.deleted.has(key))return;
      const source=this.pending&&sameSource(this.pending.source,change.channelId,change.messageId)?this.pending.source:
        this.state.card&&sameSource(this.state.card,change.channelId,change.messageId)?this.state.card:null;
      if(!source)return;
      const target=typeof change.content==='string'?lastNoteTarget(change.content,this.configuration.instances):null;
      this.remember(key,target?.url??null);
      if(target)this.reserve(target,source);else this.removeSource(change.channelId,change.messageId);return;
    }
    const source=this.source(change.message);if(!source)return;
    const key=sourceKey(source.sourceChannelId,source.sourceMessageId);if(this.deleted.has(key))return;
    const target=lastNoteTarget(change.message.content,this.configuration.instances);
    const retained=this.pending&&sameSource(this.pending.source,source.sourceChannelId,source.sourceMessageId)?this.pending.target.url:
      this.state.card&&sameSource(this.state.card,source.sourceChannelId,source.sourceMessageId)?this.state.card.url:undefined;
    const previous=this.seen.has(key)?this.seen.get(key):change.previous?lastNoteTarget(change.previous.content,this.configuration.instances)?.url??null:retained;
    this.remember(key,target?.url??null);
    // An edit after both bounded histories evict its source has no trustworthy
    // previous URL. Establish a baseline without reviving a dismissed card.
    if(change.type==='update'&&previous===undefined)return;
    if(previous===(target?.url??null))return;
    if(target)this.reserve(target,source);else this.removeSource(source.sourceChannelId,source.sourceMessageId);
  }
  private removeSource(channelId:string,messageId:string):void {
    let changed=false;
    if(this.pending&&sameSource(this.pending.source,channelId,messageId)){this.cancel();changed=true;}
    if(this.state.card&&sameSource(this.state.card,channelId,messageId)){this.state.card=null;changed=true;}
    if(!changed)return;
    if(!this.pending){this.state.pendingUrl=null;this.state.errorCode=null;this.state.retryAt=null;this.state.status=this.state.card?'showing':'idle';}
    this.publish();
  }
  private reserve(target:NoteTarget,source:Source):void {
    if(this.pending?.target.url===target.url){this.pending.source=copySource(source);return;}
    if(this.state.card?.url===target.url&&sameSource(this.state.card,source.sourceChannelId,source.sourceMessageId))return;
    this.cancel();const pending:Pending={target,source:copySource(source),generation:this.generation,attempts:0};this.pending=pending;
    const startAt=Math.max(this.deps.now(),this.nextRequestAt,this.cooldowns.get(target.instanceUrl)??0);
    this.state.status='loading';this.state.pendingUrl=target.url;this.state.errorCode=null;this.state.retryAt=startAt>this.deps.now()?Math.ceil(startAt):null;this.publish();
    this.schedule(pending,startAt);
  }
  private schedule(pending:Pending,due:number):void {
    if(!this.current(pending))return;
    const wait=due-this.deps.now();
    if(wait<=0){void this.begin(pending);return;}
    this.timer=this.deps.setTimeout(()=>{this.timer=null;this.schedule(pending,due);},Math.min(wait,NOTE_INTRODUCTION_FETCH_LIMITS.maxAutomaticRetryMs));
  }
  private current(pending:Pending):boolean {return !this.stopped&&this.pending===pending&&this.generation===pending.generation;}
  private async begin(pending:Pending):Promise<void> {
    if(!this.current(pending))return;
    this.nextRequestAt=this.deps.now()+NOTE_INTRODUCTION_FETCH_LIMITS.intervalMs;pending.attempts++;
    const controller=new AbortController();this.controller=controller;
    if(this.state.status!=='loading'||this.state.retryAt!==null){this.state.status='loading';this.state.retryAt=null;this.state.errorCode=null;this.publish();}
    try{
      const note=await fetchIntroducedNote(pending.target,this.configuration,controller.signal,this.deps);
      if(!this.current(pending))return;
      this.state.card={...note,...pending.source,presentationId:++this.presentation};this.pending=null;this.controller=null;
      this.state.status='showing';this.state.pendingUrl=null;this.state.errorCode=null;this.state.retryAt=null;this.publish();
    }catch(error){
      if(!this.current(pending))return;this.controller=null;
      const failure=error instanceof NoteIntroductionFailure?error:new NoteIntroductionFailure('NOTE_INTRODUCTION_UNAVAILABLE');
      if(failure.retryAt!==null){
        this.cooldowns.set(pending.target.instanceUrl,failure.retryAt);if(this.cooldowns.size>32)this.cooldowns.delete(this.cooldowns.keys().next().value!);
      }
      this.state.status='error';this.state.errorCode=failure.code;this.state.retryAt=failure.retryAt;
      // One bounded retry of a throttled newest URL, never general polling.
      if(failure.retryAt!==null&&failure.retryAt-this.deps.now()<=NOTE_INTRODUCTION_FETCH_LIMITS.maxAutomaticRetryMs&&pending.attempts<2){
        const due=Math.max(failure.retryAt,this.nextRequestAt);
        this.schedule(pending,due);
      }else{this.pending=null;this.state.pendingUrl=null;}
      this.publish();
    }
  }
}
