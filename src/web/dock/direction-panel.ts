import {pollVisible} from './visible-poll.ts';
import {SettingForm} from './setting-form.ts';
import {DEFAULT_DIRECTION,validateDirection} from '../../studio/direction.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioClient} from '../shared/client.ts';
import {numericEditing,syncNumericControls} from './numeric-controls.ts';
const fields={'camera-return':'manualReturnSeconds','camera-fov':'portraitFov','camera-wide-height':'wideHeightRatio','camera-near':'nearClip','camera-onset':'startGraceSeconds','camera-end-confirm':'endConfirmSeconds','camera-end-grace':'endGraceSeconds','camera-lead-window':'leadershipWindowSeconds'} as const;
const get=(id:string)=>document.getElementById(id) as HTMLInputElement;
export class DirectionPanel {
 private form:SettingForm<'direction'>;
 private get busy(){return this.form.busy;}
 constructor(client:StudioClient){
  this.form=new SettingForm(client,'direction',validateDirection,'#camera-settings input,#camera-settings select,#camera-settings button','camera-message',s=>this.update(s));
  get('camera-split').addEventListener('change',()=>void this.save());
  get('camera-reset').onclick=()=>void this.save(true);
  for(const id of Object.keys(fields))get(id).addEventListener('change',()=>void this.save());
  const countdown=()=>{
   const state=client.state,output=get('auto-countdown');if(!state)return;
   get('auto').setAttribute('aria-pressed',String(state.mode!=='HOLD'));
   get('auto').setAttribute('aria-label',state.mode==='HOLD'?'自動をオン':'自動をオフ');
   get('auto').textContent=state.mode==='HOLD'?'自動 OFF':'自動 ON';
   const remaining=state.autoResumeAtMs==null?null:Math.max(0,(state.autoResumeAtMs-client.now())/1000);
   output.dataset.mode=state.mode;
   output.textContent=!client.connected?'接続待ち':remaining!==null?`自動復帰 ${remaining.toFixed(1)}秒`:state.mode==='HOLD'?'手動固定':state.mode==='MANUAL'?'撮影開始待ち':state.decision.switchAtMs?`${state.decision.phase==='END_CONFIRMING'?'終了確認':'切替まで'} ${Math.max(0,(state.decision.switchAtMs-client.now())/1000).toFixed(1)}秒`:'自動撮影中';
  };pollVisible(countdown,100);
 }
 update(state:AppSnapshot):void {
  if(this.busy)return;const d=state.studio.direction??DEFAULT_DIRECTION;
  get('camera-split').checked=d.splitEnabled;
  for(const [id,key]of Object.entries(fields))if(!numericEditing(get(id)))get(id).value=String(d[key]);syncNumericControls();
 }
 private save(reset=false):Promise<void>{
  const d={...Object.fromEntries(Object.entries(fields).map(([id,key])=>[key,Number(get(id).value)])),splitEnabled:get('camera-split').checked};
  return this.form.save(reset?DEFAULT_DIRECTION:d);
 }
}
