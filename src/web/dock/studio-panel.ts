import * as THREE from 'three';
import {loadStudioBundle,disposeObject} from '../studio/loader.ts';
import type {StudioClient} from '../shared/client.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
/** Parse with the official loader without a WebGL context when possible.
 * Only GPU-dependent texture transcoding needs a temporary validation renderer. */
export class StudioPanel {
 private busy=false;private key='uninitialized';private generation=0;
 constructor(private client:StudioClient){
  for(const id of ['studio-files','studio-folder'])get<HTMLInputElement>(id).onchange=()=>void this.load(get<HTMLInputElement>(id));
  get('studio-pick').onclick=()=>get<HTMLInputElement>('studio-files').click();
  get('studio-folder-pick').onclick=()=>get<HTMLInputElement>('studio-folder').click();
  get('studio-reset').onclick=()=>void this.reset();
  get<HTMLSelectElement>('studio-speaker-model').onchange=()=>this.syncSpeakerSelection(this.client.state);
  get('studio-speaker-apply').onclick=()=>void this.saveSpeaker();
 }
 update(state:AppSnapshot):void {
  const models=state.studio.objects.filter(o=>o.kind==='model'),key=models.map(m=>m.bundleId+':'+m.id+':'+(m.speakerUserId??'')).join(',');
  const displayKey=key+'|'+!!state.studio.broadcast?.enabled+'|'+state.participants.map(p=>p.userId+':'+p.displayName).join(',');
  if(displayKey===this.key)return;this.key=displayKey;const token=++this.generation;
  this.syncSpeakerModels(state);
  get('studio-current').textContent=models.length?'読み込み済みのモデル':state.studio.broadcast?.enabled?'標準セット':'背景なし';
  if(models.length)void this.client.localFetch('/api/studio/bundles/'+models[0]!.bundleId).then(r=>r.json()).then(b=>{if(token===this.generation)get('studio-current').textContent=b.entry+(models.length>1?` ほか${models.length-1}個`:'');}).catch(()=>{});
 }
 private lock(value:boolean){this.busy=value;for(const id of ['studio-files','studio-folder','studio-reset','studio-pick','studio-folder-pick','studio-speaker-model','studio-speaker-user','studio-speaker-apply'])(get(id) as HTMLInputElement).disabled=value;}
 private syncSpeakerModels(state:AppSnapshot):void {
  const models=state.studio.objects.filter(o=>o.kind==='model');
  get('studio-mesh-speaker-controls').hidden=models.length===0;
  const selection=get<HTMLSelectElement>('studio-speaker-model');
  const previous=selection.value;
  selection.replaceChildren(...models.map(model=>{
   const option=document.createElement('option');option.value=model.id;option.textContent=model.id;return option;
  }));
  if(models.some(m=>m.id===previous))selection.value=previous;
  this.syncSpeakerSelection(state);
 }
 private syncSpeakerSelection(state:AppSnapshot|null):void {
  if(!state)return;
  const id=get<HTMLSelectElement>('studio-speaker-model').value;
  const model=state.studio.objects.find(o=>o.kind==='model'&&o.id===id);
  const users=get<HTMLSelectElement>('studio-speaker-user');
  const option=(value:string,label:string)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
  users.replaceChildren(option('','関連付けなし'),...state.participants.map(p=>option(p.userId,p.displayName)));
  if(model?.kind==='model'&&model.speakerUserId){
   if(!state.participants.some(p=>p.userId===model.speakerUserId))users.append(option(model.speakerUserId,'保存済みID: '+model.speakerUserId));
   users.value=model.speakerUserId;
  }
 }
 private async saveSpeaker():Promise<void> {
  const state=this.client.state;
  if(this.busy||!state)return;
  const modelId=get<HTMLSelectElement>('studio-speaker-model').value;
  const userId=get<HTMLSelectElement>('studio-speaker-user').value;
  if(!state.studio.objects.some(o=>o.kind==='model'&&o.id===modelId))return;
  this.lock(true);
  try{
   const objects=state.studio.objects.map(item=>item.kind==='model'&&item.id===modelId
    ?{...item,speakerUserId:userId||undefined}:item);
   await this.client.command({type:'studio-set',scene:{...state.studio,objects}},state.revision);
   this.key='';get('studio-feedback').textContent=userId?'発話者と関連付けました。':'関連付けを解除しました。';
  }catch(e){this.report(e);}
  finally{this.lock(false);if(this.client.state)this.update(this.client.state);}
 }
 private report(e:unknown){get('studio-feedback').textContent=e instanceof Error?e.message:'STUDIO_IMPORT_FAILED';}
 private async load(input:HTMLInputElement):Promise<void>{
  const files=[...(input.files??[])];if(this.busy||!files.length||!this.client.state)return;
  this.lock(true);const state=this.client.state;get('studio-feedback').textContent='素材を検証中…';let renderer:THREE.WebGLRenderer|undefined;
  try{
   const bundle=await this.client.importStudio(files);
   let model:THREE.Group;
   try{model=await loadStudioBundle(this.client,undefined,bundle.bundleId);}
   catch(error){
    if(!(error instanceof Error)||error.message!=='STUDIO_GPU_VALIDATION_REQUIRED')throw error;
    renderer=new THREE.WebGLRenderer({canvas:document.createElement('canvas'),antialias:false});
    model=await loadStudioBundle(this.client,renderer,bundle.bundleId);
   }
   disposeObject(model);
   await this.client.command({type:'studio-set',scene:{...state.studio,objects:[{id:'studio',kind:'model',bundleId:bundle.bundleId,transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}}],camera:{blockers:[]},broadcast:{enabled:false,title:'',subtitle:''}}},state.revision);
   get('studio-feedback').textContent='適用しました';
  }catch(e){this.report(e);}finally{renderer?.dispose();renderer?.forceContextLoss();input.value='';this.lock(false);}
 }
 private async reset():Promise<void>{
  if(this.busy||!this.client.state)return;this.lock(true);
  try{const s=this.client.state;await this.client.command({type:'studio-set',scene:{...s.studio,objects:[],camera:{blockers:[]},broadcast:{enabled:true,title:'円卓討論',subtitle:'ENTAKU STUDIO'}}},s.revision);this.key='reset';this.update(this.client.state!);get('studio-feedback').textContent='標準セットへ戻しました';}
  catch(e){this.report(e);}finally{this.lock(false);}
 }
}
