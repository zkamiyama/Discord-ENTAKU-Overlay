import {DEFAULT_DIRECTION,validateDirection} from '../../studio/direction.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioClient} from '../shared/client.ts';
import {numericEditing,syncNumericControls} from './numeric-controls.ts';
const fields={'camera-return':'manualReturnSeconds','camera-fov':'portraitFov','camera-wide-height':'wideHeightRatio','camera-near':'nearClip'} as const;
const get=(id:string)=>document.getElementById(id) as HTMLInputElement;
export class DirectionPanel {
 private busy=false;
 constructor(private client:StudioClient){
  for(const id of Object.keys(fields))get(id).addEventListener('change',()=>void this.save());
  const countdown=()=>{
   const state=client.state,output=get('auto-countdown');if(!state)return;
   get('auto').setAttribute('aria-pressed',String(state.mode!=='HOLD'));
   get('auto').setAttribute('aria-label',state.mode==='HOLD'?'自動をオン':'自動をオフ');
   get('auto').textContent=state.mode==='HOLD'?'自動 OFF':'自動 ON';
   const remaining=state.autoResumeAtMs==null?null:Math.max(0,(state.autoResumeAtMs-client.now())/1000);
   output.dataset.mode=state.mode;
   output.textContent=!client.connected?'接続待ち':remaining!==null?`自動復帰 ${remaining.toFixed(1)}秒`:state.mode==='HOLD'?'手動固定':state.mode==='MANUAL'?'撮影開始待ち':state.decision.switchAtMs?`切替まで ${Math.max(0,(state.decision.switchAtMs-client.now())/1000).toFixed(1)}秒`:'自動撮影中';
  };setInterval(countdown,100);
 }
 update(state:AppSnapshot):void {
  if(this.busy)return;const d=state.studio.direction??DEFAULT_DIRECTION;
  for(const [id,key]of Object.entries(fields))if(!numericEditing(get(id)))get(id).value=String(d[key]);syncNumericControls();
 }
 private async save():Promise<void>{
  if(this.busy||!this.client.state)return;this.busy=true;get('camera-message').textContent='';
  try{const state=this.client.state,d=Object.fromEntries(Object.entries(fields).map(([id,key])=>[key,Number(get(id).value)]));
   await this.client.command({type:'studio-set',scene:{...state.studio,direction:validateDirection(d)}},state.revision);
  }catch(e){get('camera-message').textContent=e instanceof Error?e.message:'撮影設定を保存できません';}
  finally{this.busy=false;if(this.client.state)this.update(this.client.state);}
 }
}
