import {pollVisible} from './visible-poll.ts';
import {capturePreset,type Theme} from '../../presets/schema.ts';
import type {StudioClient} from '../shared/client.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {PresetEntry} from '../../presets/store.ts';
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const messages:Record<string,string>={PRESET_EXISTS:'同名のファイルがあります。別の名前にしてください。',PRESET_NAME_INVALID:'ファイル名に使用できない文字があります。',PRESET_INVALID:'JSONの形式または設定値が正しくありません。',PRESET_WRITE_FAILED:'プリセットを保存できませんでした。',REVISION_CONFLICT:'別の操作で設定が変わりました。もう一度操作してください。',STUDIO_BUNDLE_NOT_FOUND:'プリセットのスタジオ素材が見つかりません。',ASSET_NOT_FOUND:'プリセットの人物画像が見つかりません。'};
export class PresetPanel {
 private busy=false;private listing=false;private name='';private signature='';private listKey='';private stateKey='';private dirtyKey='';private dirty=false;
 private select=get<HTMLSelectElement>('preset-select');private dialog=get<HTMLDialogElement>('preset-dialog');
 constructor(private client:StudioClient){
  try{const saved=JSON.parse(localStorage.getItem('entaku-active-preset')??'null');if(saved&&typeof saved.name==='string'&&saved.name.length<=100){this.name=saved.name;this.signature=typeof saved.signature==='string'?saved.signature:'';}}catch{}
  this.select.onchange=()=>{const name=this.select.value;if(name==='__new__')this.open();else if(name)void this.apply(name);};
  get('preset-refresh').onclick=()=>void this.refresh();
  get('preset-cancel').onclick=()=>this.dialog.close();
  get<HTMLFormElement>('preset-form').onsubmit=e=>{e.preventDefault();void this.save();};
  this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
  this.dialog.addEventListener('close',()=>{this.stateKey='';if(this.client.state)this.update(this.client.state);this.select.focus();});
  get('theme').addEventListener('change',()=>{if(this.client.state)this.update(this.client.state);});
  window.addEventListener('focus',()=>void this.refresh());
  pollVisible(async()=>{if(document.activeElement!==this.select)await this.refresh();},5000);
 }
 update(state:AppSnapshot):void {
  const theme=get<HTMLSelectElement>('theme').value as Theme;
  const dirtyKey=[state.serverEpoch,state.revision,state.session.sessionId,state.session.revision,state.studio.revision,state.mode,theme].join('|');
  if(dirtyKey!==this.dirtyKey){this.dirtyKey=dirtyKey;this.dirty=JSON.stringify(capturePreset(state,theme))!==this.signature;}
  const dirty=this.dirty;
  this.select.title=this.name?this.name+(dirty?'（保存後に変更あり）':''):'data/presets のJSONを選択';
  const current=this.select.options[0];if(current)current.textContent=this.name&&dirty?`${this.name} *（変更中）`:'現在の設定';
  // Native select does not emit change for reselecting its existing value. A
  // modified preset uses a separate placeholder so selecting its file restores it.
  const key=this.name+'|'+dirty;
  if(!this.busy&&this.stateKey!==key){this.stateKey=key;this.select.value=this.name&&!dirty?this.name:'';}
 }
 private remember(signature:string):void {this.dirtyKey='';this.signature=signature;try{localStorage.setItem('entaku-active-preset',JSON.stringify({name:this.name,signature}));}catch{}}
 private async refresh():Promise<void>{
  if(this.listing)return;this.listing=true;
  try{
   const {items}=await (await this.client.localFetch('/api/presets')).json() as {items:PresetEntry[]};const key=JSON.stringify(items);
   if(key===this.listKey)return;this.listKey=key;
   const placeholder=new Option('現在の設定', '');this.select.replaceChildren(placeholder);
   const group=document.createElement('optgroup');group.label='プリセット';
   for(const p of items){const option=new Option(p.name+(p.valid?'':'（読み込み不可）'),p.name);option.disabled=!p.valid;option.title=p.error??p.name;group.append(option);}this.select.append(group);
   const action=document.createElement('optgroup');action.label='────────';action.append(new Option('現在の状態を新規プリセットに…','__new__'));this.select.append(action);
   if(!items.some(p=>p.name===this.name))this.name='';this.select.value=this.name;this.stateKey='';if(this.client.state)this.update(this.client.state);
  }catch(e){get('preset-feedback').textContent=e instanceof Error?e.message:'一覧を取得できません';}finally{this.listing=false;}
 }
 private open(){this.select.value=this.name;get('preset-error').textContent='';get<HTMLInputElement>('preset-name').value='';this.dialog.showModal();get<HTMLInputElement>('preset-name').focus();}
 private lock(value:boolean){this.busy=value;this.select.disabled=value;for(const id of ['preset-name','preset-save','preset-cancel'])(get(id) as HTMLInputElement).disabled=value;}
 private async send(type:'preset-save'|'preset-apply',name:string){
  const result=await this.client.requestCommand(type==='preset-save'?{type,name,theme:get<HTMLSelectElement>('theme').value as Theme}:{type,name});
  if(typeof result.presetName!=='string'||typeof result.presetSignature!=='string'||(type==='preset-apply'&&!['system','light','dark'].includes(String(result.theme))))throw new Error('PRESET_RESPONSE_INVALID');
  return {presetName:result.presetName,presetSignature:result.presetSignature,theme:result.theme as Theme};
 }
 private report(e:unknown,id:string){const code=e instanceof Error?e.message:'PRESET_FAILED';get(id).textContent=messages[code]??code;}
 private async save(){if(this.busy)return;this.lock(true);try{
   const r=await this.send('preset-save',get<HTMLInputElement>('preset-name').value);this.name=r.presetName;this.remember(r.presetSignature);
   await this.refresh();this.select.value=this.name;this.dialog.close();get('preset-feedback').textContent=`保存: ${this.name}`;
  }catch(e){this.report(e,'preset-error');}finally{this.lock(false);}}
 private async apply(name:string){if(this.busy)return;this.lock(true);get('preset-feedback').textContent='プリセットを適用中…';try{
   const r=await this.send('preset-apply',name);this.name=r.presetName;this.select.value=this.name;
   get<HTMLSelectElement>('theme').value=r.theme;get('theme').dispatchEvent(new Event('change'));this.remember(r.presetSignature);get('preset-feedback').textContent=`適用: ${this.name}`;
  }catch(e){this.select.value=this.name;this.report(e,'preset-feedback');}finally{this.lock(false);}}
}
