import * as THREE from 'three';
import {loadStudioBundle,disposeObject} from '../studio/loader.ts';
import type {StudioClient} from '../shared/client.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
/** Direct asset replacement. The temporary loader validates textures/geometry,
 * but owns no visible preview window or persistent WebGL context. */
export class StudioPanel {
 private busy=false;private key='uninitialized';private generation=0;
 constructor(private client:StudioClient){
  for(const id of ['studio-files','studio-folder'])get<HTMLInputElement>(id).onchange=()=>void this.load(get<HTMLInputElement>(id));
  get('studio-pick').onclick=()=>get<HTMLInputElement>('studio-files').click();
  get('studio-folder-pick').onclick=()=>get<HTMLInputElement>('studio-folder').click();
  get('studio-reset').onclick=()=>void this.reset();
 }
 update(state:AppSnapshot):void {
  const models=state.studio.objects.filter(o=>o.kind==='model'),key=models.map(m=>m.bundleId).join(',');
  const displayKey=key+'|'+!!state.studio.broadcast?.enabled;if(displayKey===this.key)return;this.key=displayKey;const token=++this.generation;
  get('studio-current').textContent=models.length?'読み込み済みのモデル':state.studio.broadcast?.enabled?'標準セット':'背景なし';
  if(models.length)void this.client.localFetch('/api/studio/bundles/'+models[0]!.bundleId).then(r=>r.json()).then(b=>{if(token===this.generation)get('studio-current').textContent=b.entry+(models.length>1?` ほか${models.length-1}個`:'');}).catch(()=>{});
 }
 private lock(value:boolean){this.busy=value;for(const id of ['studio-files','studio-folder','studio-reset','studio-pick','studio-folder-pick'])(get(id) as HTMLInputElement).disabled=value;}
 private report(e:unknown){get('studio-feedback').textContent=e instanceof Error?e.message:'STUDIO_IMPORT_FAILED';}
 private async load(input:HTMLInputElement):Promise<void>{
  const files=[...(input.files??[])];if(this.busy||!files.length||!this.client.state)return;
  this.lock(true);const state=this.client.state;get('studio-feedback').textContent='素材を検証中…';let renderer:THREE.WebGLRenderer|undefined;
  try{
   const bundle=await this.client.importStudio(files);
   renderer=new THREE.WebGLRenderer({canvas:document.createElement('canvas'),antialias:false});
   const model=await loadStudioBundle(this.client,renderer,bundle.bundleId);disposeObject(model);
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
