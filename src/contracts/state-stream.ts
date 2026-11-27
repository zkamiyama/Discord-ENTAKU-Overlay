import type {AppSnapshot} from './domain.ts';

export const STATE_PROTOCOL=2 as const;
type Field=keyof AppSnapshot;
const fields={
 protocolVersion:true,serverEpoch:true,seq:true,revision:true,serverNowMs:true,clockRate:true,
 connection:true,errorCode:true,channel:true,studio:true,speech:true,avatarProfiles:true,participants:true,
 session:true,straightLength:true,deskOffsetZ:true,seats:true,layoutMotion:true,autoResumeAtMs:true,
 mode:true,decision:true,camera:true,source:true,
} satisfies Record<Field,true>;
const keys=Object.keys(fields) as Field[];
const optional=new Set<Field>(['clockRate','errorCode','deskOffsetZ','layoutMotion','autoResumeAtMs']);
const configuration=new Set<Field>(['studio','avatarProfiles']);
const known=(key:string):key is Field=>Object.hasOwn(fields,key);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
function validState(value:unknown):value is AppSnapshot {
 if(!record(value)||Object.keys(value).some(k=>!known(k))||keys.some(k=>!optional.has(k)&&!(k in value)))return false;
 return value.protocolVersion===STATE_PROTOCOL&&typeof value.serverEpoch==='string'&&integer(value.seq)&&integer(value.revision)&&finite(value.serverNowMs)&&
  (value.clockRate===undefined||finite(value.clockRate)&&value.clockRate>=0)&&
  record(value.studio)&&record(value.session)&&record(value.camera)&&record(value.decision)&&
  Array.isArray(value.speech)&&Array.isArray(value.participants)&&Array.isArray(value.avatarProfiles)&&Array.isArray(value.seats);
}
function freeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);Object.freeze(value);
 }
 return value;
}
type EncodedFields=Map<Field,string>;
const body=(values:EncodedFields)=>[...values].map(([key,value])=>JSON.stringify(key)+':'+value).join(',');
export interface EncodedFrame {
 readonly frame:number;
 readonly base?:number;
 readonly delta?:string;
 full():string;
}

/** One serialization per changed section, shared by every connected socket.
 * Configuration is immutable for a given engine epoch/revision. A wire frame
 * is independent of domain seq, which intentionally need not change per tick. */
export class StatePublisher{
 private counter=0;
 private epoch='';
 private revision=-1;
 private fields:EncodedFields=new Map();
 latest?:EncodedFrame;
 publish(state:AppSnapshot):EncodedFrame{
  const previous=this.latest,old=this.fields,sameEpoch=state.serverEpoch===this.epoch;
  const sameConfig=sameEpoch&&state.revision===this.revision;
  const next:EncodedFields=new Map(),changed:EncodedFields=new Map(),removed:Field[]=[];
  for(const key of keys){
   const value=sameConfig&&configuration.has(key)?old.get(key):JSON.stringify(state[key]);
   if(value!==undefined){next.set(key,value);if(old.get(key)!==value)changed.set(key,value);}
   else if(old.has(key))removed.push(key);
  }
  const frame=++this.counter,base=previous&&sameEpoch?previous.frame:undefined;
  let full:string|undefined;
  const delta=base===undefined?undefined:'{"type":"snapshot-delta","epoch":'+JSON.stringify(state.serverEpoch)+',"base":'+base+',"frame":'+frame+',"changes":{'+body(changed)+'},"removed":'+JSON.stringify(removed)+'}';
  this.latest={frame,base,delta,full:()=>full??=('{"type":"snapshot","frame":'+frame+',"state":{'+body(next)+'}}')};
  this.fields=next;this.epoch=state.serverEpoch;this.revision=state.revision;
  return this.latest;
 }
 reset():void{this.latest=undefined;this.fields.clear();this.epoch='';this.revision=-1;}
}

/** Transactional receiver: an incomplete or out-of-order delta cannot mutate
 * the previous state. Retained immutable sections also give UI consumers
 * reliable identity comparisons without repeated stringify/deep equality. */
export class StateReceiver{
 private state:AppSnapshot|null=null;
 private frame=0;
 get ready():boolean{return this.state!==null;}
 reset():void{this.state=null;this.frame=0;}
 accept(packet:unknown):AppSnapshot|null{
  if(!record(packet)||!integer(packet.frame)||packet.frame<1)return null;
  if(packet.type==='snapshot'){
   if(!validState(packet.state)||packet.frame<this.frame)return null;
   this.state=freeze(packet.state);this.frame=packet.frame;return this.state;
  }
  if(packet.type!=='snapshot-delta'||!this.state||packet.epoch!==this.state.serverEpoch||
    packet.base!==this.frame||packet.frame!==this.frame+1||!record(packet.changes)||!Array.isArray(packet.removed))return null;
  if(Object.keys(packet.changes).some(key=>!known(key)||key==='serverEpoch'||key==='protocolVersion')||
    packet.removed.some(key=>typeof key!=='string'||!known(key)||!optional.has(key)||Object.hasOwn(packet.changes as object,key)))return null;
  const next:Record<string,unknown>={...this.state,...packet.changes};
  for(const key of packet.removed)delete next[key as string];
  if(!validState(next))return null;
  this.state=freeze(next);this.frame=packet.frame;return this.state;
 }
}
