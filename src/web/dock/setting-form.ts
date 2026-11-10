import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioScene} from '../../studio/manifest.ts';
import type {StudioClient} from '../shared/client.ts';
import {syncNumericControls} from './numeric-controls.ts';
type Section='quality'|'post'|'exposure'|'direction'|'gaussian';
type Control=HTMLInputElement|HTMLSelectElement|HTMLButtonElement;
/** All parameter panels share the same lock, revision and failure policy. Never
 * retry a stale full scene: request current state and let the operator retry. */
export class SettingForm<K extends Section> {
 busy=false;
 constructor(private client:StudioClient,private section:K,private validate:(value:unknown)=>NonNullable<StudioScene[K]>,private selector:string,private messageId:string,private update:(state:AppSnapshot)=>void){}
 async save(value:unknown):Promise<void>{
  if(this.busy||!this.client.state)return;
  const message=document.getElementById(this.messageId)!;message.textContent='';
  let clean:NonNullable<StudioScene[K]>;
  try{clean=this.validate(value);}catch(error){message.textContent=error instanceof Error?error.message:'設定を保存できません';return;}
  // Native number inputs may emit change again on blur after a scripted/range
  // commit. Do not disable the next control for an already applied value.
  if(JSON.stringify(this.client.state.studio[this.section])===JSON.stringify(clean))return;
  this.busy=true;
  const controls=[...document.querySelectorAll<Control>(this.selector)];
  const disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);syncNumericControls();
  try{
   const state=this.client.state;
   await this.client.command({type:'studio-set',scene:{...state.studio,[this.section]:clean}},state.revision);
  }catch(error){
   const code=error instanceof Error?error.message:'設定を保存できません';
   message.textContent=code;
   if(code==='REVISION_CONFLICT')this.client.resync();
  }finally{
   this.busy=false;controls.forEach((c,i)=>c.disabled=disabled[i]!);
   if(this.client.state)this.update(this.client.state);syncNumericControls();
  }
 }
}
