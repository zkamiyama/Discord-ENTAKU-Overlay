import type {AppSnapshot,Participant} from '../../contracts/domain.ts';
import type {AvatarProfile} from '../../assets/avatar-profile.ts';

export interface RosterVisual {
 user:Participant;
 profile?:AvatarProfile;
 opacity:number;
 update(user:Participant,profile?:AvatarProfile):void;
 dispose():void;
}

/** Seat reservations are persistent data, not GPU leases. Only assigned users
 * can own graphics; an absent user's graphics survive only its departure fade. */
export class AvatarRoster<T extends RosterVisual>{
 readonly avatars=new Map<string,T>();
 private profiles=new Map<string,AvatarProfile>();
 private lastProfiles?:AvatarProfile[];
 private epoch='';
 private stopped=false;
 constructor(private readonly create:(person:Participant,profile?:AvatarProfile)=>T){}
 sync(state:AppSnapshot):void {
  if(this.stopped)return;
  if(state.serverEpoch!==this.epoch){
   this.clear();this.epoch=state.serverEpoch;this.lastProfiles=undefined;
  }
  if(state.avatarProfiles!==this.lastProfiles){
   // Preserve references for unchanged profiles even when another setting was
   // edited. Avatar.update therefore needs no per-snapshot serialization.
   const profiles=new Map<string,AvatarProfile>();
   for(const profile of state.avatarProfiles){
    const previous=this.profiles.get(profile.userId);
    profiles.set(profile.userId,previous&&JSON.stringify(previous)===JSON.stringify(profile)?previous:profile);
   }
   this.profiles=profiles;this.lastProfiles=state.avatarProfiles;
  }
  const assigned=new Set(state.session.reservations.map(r=>r.userId));
  const incoming=new Map(state.participants.map(p=>[p.userId,p]));
  for(const [id,avatar] of this.avatars){
   const person=incoming.get(id);
   if(!assigned.has(id)||!person){this.remove(id,avatar);continue;}
   avatar.update(person,person.presence==='absent'?avatar.profile:this.profiles.get(id));
  }
  for(const person of state.participants){
   if(person.presence!=='absent'&&assigned.has(person.userId)&&!this.avatars.has(person.userId)){
    this.avatars.set(person.userId,this.create(person,this.profiles.get(person.userId)));
   }
  }
 }
 pruneFaded():void {
  for(const [id,avatar] of this.avatars)if(avatar.user.presence==='absent'&&avatar.opacity<=.005)this.remove(id,avatar);
 }
 private remove(id:string,avatar:T):void{this.avatars.delete(id);avatar.dispose();}
 private clear():void{for(const [id,avatar] of this.avatars)this.remove(id,avatar);this.profiles.clear();this.lastProfiles=undefined;}
 dispose():void{if(!this.stopped){this.stopped=true;this.clear();}}
}
