import {validateSession,newSession} from '../domain/seat-allocator.ts';
import {validateStudioScene,type StudioScene} from '../studio/manifest.ts';
import {validateExposure} from '../studio/exposure.ts';
import {validateQuality} from '../studio/quality.ts';
import {validatePost} from '../studio/post-effects.ts';
import {validateDirection} from '../studio/direction.ts';
import {validateProfile,type AvatarProfile} from '../assets/avatar-profile.ts';
import type {AppSnapshot,SeatSession} from '../contracts/domain.ts';
export type Theme='system'|'light'|'dark';
export interface SeatingPreset {
 minSeats:number;capacity:number;seatPitch:number;moderatorSlots:number[];
 straightLengthFloor:number;growthAnchorLength?:number;
 assignments:Array<{userId:string;slotIndex:number}>;
}
export interface ParameterPreset {
 schemaVersion:1;kind:'entaku-preset';studio:StudioScene;avatarProfiles:AvatarProfile[];
 seating:SeatingPreset;autoCamera:boolean;theme:Theme;
}
export function seatingSession(value:SeatingPreset,channelId:string,sessionId:string):SeatSession {
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['minSeats','capacity','seatPitch','moderatorSlots','straightLengthFloor','growthAnchorLength','assignments'].includes(k))||!Array.isArray(value.assignments)||value.assignments.length>32)throw new Error('PRESET_SEATING_INVALID');
 const {assignments,...parameters}=value;
 return validateSession({...newSession(channelId,sessionId),...parameters,revision:0,peakPresentCount:0,
  reservations:value.assignments.map(a=>({userId:a.userId,slotIndex:a.slotIndex,seatId:`seat-${a.slotIndex}`,reservedAtUtc:'1970-01-01T00:00:00Z'})),waitingUserIds:[],moderatorIds:[]});
}
export function seatingParameters(value:SeatSession):SeatingPreset {
 const s=validateSession(value);
 return {minSeats:s.minSeats,capacity:s.capacity,seatPitch:s.seatPitch!,moderatorSlots:s.moderatorSlots!,straightLengthFloor:s.straightLengthFloor!,
  ...(s.growthAnchorLength===undefined?{}:{growthAnchorLength:s.growthAnchorLength}),assignments:s.reservations.map(r=>({userId:r.userId,slotIndex:r.slotIndex})).sort((a,b)=>a.slotIndex-b.slotIndex)};
}
export function validatePreset(value:unknown):ParameterPreset {
 const p=value as ParameterPreset;
 if(!p||typeof p!=='object'||Array.isArray(p)||p.schemaVersion!==1||p.kind!=='entaku-preset'||Object.keys(p).some(k=>!['schemaVersion','kind','studio','avatarProfiles','seating','autoCamera','theme'].includes(k)))throw new Error('PRESET_INVALID');
 if(!['system','light','dark'].includes(p.theme)||typeof p.autoCamera!=='boolean'||!Array.isArray(p.avatarProfiles)||p.avatarProfiles.length>256)throw new Error('PRESET_INVALID');
 const avatarProfiles=p.avatarProfiles.map(validateProfile);if(new Set(avatarProfiles.map(a=>a.userId)).size!==avatarProfiles.length)throw new Error('PRESET_INVALID');
 const scene=validateStudioScene(p.studio),studio={...scene,revision:0,exposure:validateExposure(scene.exposure),quality:validateQuality(scene.quality),post:validatePost(scene.post),direction:validateDirection(scene.direction)};
 return {schemaVersion:1,kind:'entaku-preset',studio,avatarProfiles,seating:seatingParameters(seatingSession(p.seating,'0','preset')),autoCamera:p.autoCamera,theme:p.theme};
}
/** All editable settings, not voice packets, tokens, timers or network endpoints. */
export function capturePreset(state:AppSnapshot,theme:Theme):ParameterPreset {
 return validatePreset({schemaVersion:1,kind:'entaku-preset',studio:state.studio,avatarProfiles:state.avatarProfiles,seating:seatingParameters(state.session),autoCamera:state.mode!=='HOLD',theme});
}
export function presetFilename(value:unknown):string {
 if(typeof value!=='string')throw new Error('PRESET_NAME_INVALID');
 let name=value.trim().normalize('NFC');if(!/\.json$/i.test(name))name+='.json';
 const stem=name.slice(0,-5);
 if(!stem||name.length>100||/^[. ]|[. ]$/.test(stem)||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))throw new Error('PRESET_NAME_INVALID');
 return stem+'.json';
}
