import type {DirectorMode} from './domain.ts';
import type {ReplayControl} from './diagnostics.ts';
import type {Theme} from '../presets/schema.ts';

/** Transport commands. Structured assets are deliberately unknown until their
 * domain validators have checked them; a TypeScript cast is not validation. */
export type Command =
  | {type:'mode';mode:DirectorMode}
  | {type:'single'|'avatar-reset';userId:string}
  | {type:'release';userId:string;confirm:true}
  | {type:'new-session';confirm:true}
  | {type:'seat-move';userId:string;slotIndex:number}
  | {type:'moderators';userIds:string[]}
  | {type:'studio-set';scene:unknown}
  | {type:'avatar-set';profile:unknown}
  | {type:'preset-save';name:string;theme:Theme}
  | {type:'preset-apply';name:string}
  | {type:'replay-control';action:ReplayControl['action'];value?:number}
  | {type:'demo-speaking';userId:string;active:boolean}
  | {type:'demo-presence';userId:string;present:boolean}
  | {[K in 'wide'|'retry'|'demo-add'|'studio-reset'|'record-start'|'record-stop']:{type:K}}['wide'|'retry'|'demo-add'|'studio-reset'|'record-start'|'record-stop'];
export type CommandEnvelope = Command & {requestId:string;expectedRevision:number};

export function parseCommand(value:unknown):CommandEnvelope {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_COMMAND');
  const c=value as Record<string,unknown>;
  const id=(v:unknown)=>typeof v==='string'&&/^\d{1,20}$/.test(v);
  if(typeof c.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(c.requestId)||!Number.isSafeInteger(c.expectedRevision))throw new Error('INVALID_COMMAND');
  let valid=false;
  switch(c.type){
    case 'mode':valid=['AUTO','MANUAL','HOLD'].includes(String(c.mode));break;
    case 'single':case 'avatar-reset':valid=id(c.userId);break;
    case 'release':valid=id(c.userId)&&c.confirm===true;break;
    case 'new-session':valid=c.confirm===true;break;
    case 'seat-move':valid=id(c.userId)&&Number.isInteger(c.slotIndex);break;
    case 'moderators':valid=Array.isArray(c.userIds)&&c.userIds.every(id);break;
    case 'studio-set':valid='scene' in c;break;
    case 'avatar-set':valid='profile' in c;break;
    case 'preset-save':valid=typeof c.name==='string'&&['system','light','dark'].includes(String(c.theme));break;
    case 'preset-apply':valid=typeof c.name==='string';break;
    case 'replay-control':valid=['play','pause','seek','rate'].includes(String(c.action))&&(!['seek','rate'].includes(String(c.action))||(typeof c.value==='number'&&Number.isFinite(c.value)));break;
    case 'demo-speaking':valid=id(c.userId)&&typeof c.active==='boolean';break;
    case 'demo-presence':valid=id(c.userId)&&typeof c.present==='boolean';break;
    case 'wide':case 'retry':case 'demo-add':case 'studio-reset':case 'record-start':case 'record-stop':valid=true;break;
  }
  if(!valid)throw new Error('INVALID_COMMAND');
  return c as CommandEnvelope;
}
