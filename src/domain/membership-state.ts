import type {Participant,SpeakingState} from '../contracts/domain.ts';
import {SpeakerTracker} from './speaker-tracker.ts';

/** Voice membership and pending START/STOP events have one owner. Seat allocation
 * and camera transitions are intentionally outside this class. */
export class MembershipState {
 participants=new Map<string,Participant>();
 tracker=new SpeakerTracker();
 private pending=new Map<string,{state:'active'|'inactive';expires:number}>();
 clone():MembershipState {
  const copy=new MembershipState();copy.participants=structuredClone(this.participants);
  copy.pending=structuredClone(this.pending);copy.tracker=this.tracker.clone();return copy;
 }
 presentIds():string[]{return [...this.participants.values()].filter(p=>p.presence==='present').map(p=>p.userId);}
 clearSpeech(stale:boolean):void {
  this.tracker.clear();this.pending.clear();
  for(const p of this.participants.values()){p.speaking='unknown';if(stale&&p.presence==='present')p.presence='stale';}
 }
 replace(incoming:readonly Participant[],now:number):void {
  const ids=new Set(incoming.map(p=>p.userId));
  for(const p of this.participants.values())if(!ids.has(p.userId)){p.presence='absent';p.speaking='unknown';this.tracker.update(p.userId,'unknown',now);}
  for(const p of incoming)this.upsert(p,now);
 }
 upsert(incoming:Participant,now:number):void {
  const old=this.participants.get(incoming.userId),speaking=old?.presence==='present'?old.speaking:'unknown';
  this.participants.set(incoming.userId,{...structuredClone(incoming),presence:'present',speaking});
  const pending=this.pending.get(incoming.userId);if(!pending)return;
  this.pending.delete(incoming.userId);
  if(pending.expires>=now){this.participants.get(incoming.userId)!.speaking=pending.state;this.tracker.update(incoming.userId,pending.state,now);}
 }
 leave(id:string,now:number):void {
  const p=this.participants.get(id);if(p){p.presence='absent';p.speaking='unknown';this.tracker.update(id,'unknown',now);}
  this.pending.delete(id);
 }
 speak(id:string,state:Extract<SpeakingState,'active'|'inactive'>,now:number):void {
  const p=this.participants.get(id);
  if(p?.presence==='present'){p.speaking=state;this.tracker.update(id,state,now);}
  else if(!p&&this.pending.size<1024)this.pending.set(id,{state,expires:now+5000});
 }
 expire(now:number):void {for(const [id,item] of this.pending)if(item.expires<now)this.pending.delete(id);}
}
