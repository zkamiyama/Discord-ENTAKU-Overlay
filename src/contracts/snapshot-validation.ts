import {validateProfile} from '../assets/avatar-profile.ts';
import {validateSession} from '../domain/seat-allocator.ts';
import {validateStudioScene} from '../studio/manifest.ts';
import type {AppSnapshot} from './domain.ts';

type Validator=(value:unknown)=>boolean;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const string=(v:unknown):v is string=>typeof v==='string';
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const nonnegative=(v:unknown)=>number(v)&&v>=0;
const integer=(v:unknown)=>nonnegative(v)&&Number.isSafeInteger(v);
const boolean=(v:unknown)=>typeof v==='boolean';
const id=(v:unknown)=>string(v)&&/^\d{1,20}$/.test(v);
const oneOf=(v:unknown,choices:readonly string[])=>string(v)&&choices.includes(v);
const optional=(v:unknown,check:Validator)=>v===undefined||check(v);
const vector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(number);
const list=(v:unknown,check:Validator)=>Array.isArray(v)&&v.every(check);
const validated=(check:(v:unknown)=>unknown):Validator=>v=>{check(v);return true;};

function shot(v:unknown):boolean {
 if(!record(v)||!list(v.userIds,id))return false;
 const count=(v.userIds as unknown[]).length;
 return v.kind==='WIDE'?count===0:v.kind==='SINGLE'?count===1:oneOf(v.kind,['TWO_SHOT','SPLIT'])&&count===2;
}
function pose(v:unknown):boolean {
 return record(v)&&vector(v.position)&&vector(v.target)&&number(v.fov)&&v.fov>0&&v.fov<180;
}
function camera(v:unknown):boolean {
 return record(v)&&integer(v.id)&&shot(v.shot)&&string(v.reason)&&oneOf(v.transition,['CUT','MOVE'])&&
  pose(v.from)&&pose(v.to)&&number(v.startMs)&&nonnegative(v.durationMs)&&optional(v.via,vector)&&
  optional(v.studioHidden,boolean)&&optional(v.panels,p=>Array.isArray(p)&&p.length===2&&p.every(
   panel=>record(panel)&&id(panel.userId)&&pose(panel.pose)&&optional(panel.foregroundUserId,id)&&optional(panel.visibilityReason,string)))&&
  optional(v.composition,x=>oneOf(x,['SPLIT','WIDE','SINGLE_OTS','SINGLE_CLEAN','TWO_SHOT','MODERATOR_SINGLE','MODERATOR_TWO']))&&
  optional(v.safetyReason,string)&&optional(v.foregroundUserId,id)&&optional(v.visibilityReason,string);
}
function decision(v:unknown):boolean {
 return record(v)&&shot(v.shot)&&string(v.reason)&&boolean(v.changed)&&nonnegative(v.holdRemainingMs)&&
  optional(v.phase,x=>oneOf(x,['STABLE','START_PENDING','END_CONFIRMING','END_GRACE','MANUAL','UNAVAILABLE']))&&
  optional(v.pendingShot,shot)&&optional(v.switchAtMs,number)&&optional(v.leaderUserId,id)&&optional(v.dialogue,d=>
   record(d)&&(d.pair===null||Array.isArray(d.pair)&&d.pair.length===2&&d.pair.every(id))&&
   Array.isArray(d.spokenMs)&&d.spokenMs.length===2&&d.spokenMs.every(nonnegative)&&
   nonnegative(d.pairShare)&&nonnegative(d.minorShare)&&nonnegative(d.overlapMs)&&nonnegative(d.coverageMs)&&
   integer(d.alternations)&&boolean(d.thirdActive)&&boolean(d.eligible)&&string(d.reason));
}
function seat(v:unknown):boolean {
 return record(v)&&integer(v.slotIndex)&&vector(v.position)&&vector(v.inward)&&number(v.baseYawRad)&&vector(v.faceAnchor)&&
  optional(v.zone,x=>oneOf(x,['moderator','left','right','front']))&&optional(v.oppositeSlot,integer)&&optional(v.row,integer);
}
function participant(v:unknown):boolean {
 return record(v)&&id(v.userId)&&id(v.channelId)&&string(v.username)&&string(v.displayName)&&
  optional(v.avatarUrl,string)&&optional(v.iconAssetId,x=>string(x)&&/^[a-f0-9]{64}$/.test(x))&&optional(v.nick,string)&&optional(v.globalName,string)&&
  oneOf(v.presence,['present','absent','stale'])&&oneOf(v.speaking,['active','inactive','unknown'])&&
  record(v.voice)&&['selfMute','selfDeaf','serverMute','serverDeaf'].every(key=>boolean((v.voice as Record<string,unknown>)[key]));
}
const sections={
 studio:validated(validateStudioScene),
 avatarProfiles:(v:unknown)=>list(v,validated(validateProfile)),
 session:validated(validateSession),
 camera,decision,
 seats:(v:unknown)=>list(v,seat),
 layoutMotion:(v:unknown)=>optional(v,m=>record(m)&&list(m.fromSeats,seat)&&nonnegative(m.fromStraightLength)&&
  optional(m.fromDeskOffsetZ,number)&&number(m.startMs)&&nonnegative(m.durationMs)),
 participants:(v:unknown)=>list(v,participant),
 speech:(v:unknown)=>list(v,s=>record(s)&&id(s.userId)&&nonnegative(s.activeMs)&&number(s.ratio)&&
  boolean(s.qualified)&&optional(s.speechWindowMs,nonnegative)&&optional(s.speechMs10s,nonnegative)),
} satisfies Partial<Record<keyof AppSnapshot,Validator>>;

/** Reuse domain validators for authored settings. Immutable sections retained
 * by a delta have already passed validation and need no second traversal. */
export function validSnapshotSections(value:Record<string,unknown>,previous?:AppSnapshot|null):boolean {
 try{
  for(const [field,check] of Object.entries(sections)){
   if(previous&&value[field]===previous[field as keyof AppSnapshot])continue;
   if(!check(value[field]))return false;
  }
  return true;
 }catch{return false;}
}
