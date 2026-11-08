import {DEFAULT_QUALITY} from '../../studio/quality.ts';
import {DEFAULT_EXPOSURE} from '../../studio/exposure.ts';
import type { StudioClient } from '../shared/client.ts';
import { DEFAULT_STUDIO_SCENE,validateStudioScene,type StudioObject,type StudioScene } from '../../studio/manifest.ts';
import { StudioVisual } from '../studio/visual.ts';
import { PreviewStage } from '../studio/preview.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const positionFields=['studio-x','studio-y','studio-z'],scaleFields=['studio-sx','studio-sy','studio-sz'];
export class StudioEditor {
  private dialog=$<HTMLDialogElement>('studio-editor');
  private draft:StudioScene=structuredClone(DEFAULT_STUDIO_SCENE);
  private revision=0;private selected='';private files:File[]=[];private busy=false;
  private preview:PreviewStage|null=null;private visual:StudioVisual|null=null;
  private generation=0;
  constructor(private client:StudioClient){
    $('studio-open').onclick=()=>this.open();
    $('studio-cancel').onclick=()=>{if(!this.busy)this.dialog.close();};
    this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
    this.dialog.addEventListener('close',()=>{this.generation++;this.visual?.dispose();this.visual=null;this.preview?.dispose();this.preview=null;});
    $<HTMLInputElement>('studio-files').onchange=()=>this.selectFiles($<HTMLInputElement>('studio-files').files);
    $<HTMLInputElement>('studio-folder').onchange=()=>this.selectFiles($<HTMLInputElement>('studio-folder').files);
    $('studio-import').onclick=()=>void this.import();
    $('studio-apply').onclick=()=>void this.apply();
    $('studio-reset').onclick=()=>{this.draft=structuredClone(DEFAULT_STUDIO_SCENE);this.changed();};
    $('studio-add-floor').onclick=()=>this.add({id:this.id('floor'),kind:'plane',size:[20,20],color:'#354052',transform:{position:[0,-.02,0],yawDeg:0,scale:[1,1,1]}});
    $('studio-add-box').onclick=()=>this.add({id:this.id('box'),kind:'box',size:[1,1,1],color:'#638199',transform:{position:[4,.5,0],yawDeg:0,scale:[1,1,1]}});
    $('studio-add-light').onclick=()=>this.add({id:this.id('light'),kind:'point-light',color:'#ffffff',intensity:10,position:[0,4,0]});
    $('studio-delete').onclick=()=>{this.draft.objects=this.draft.objects.filter(o=>o.id!==this.selected);this.selected='';this.changed();};
    $<HTMLSelectElement>('studio-object').onchange=()=>{this.selected=$<HTMLSelectElement>('studio-object').value;this.fields();};
    for(const id of [...positionFields,...scaleFields,'studio-yaw'])$(id).addEventListener('change',()=>this.move());
    for(const id of ['anchor-x','anchor-y','anchor-z','anchor-yaw','studio-capacity'])$(id).addEventListener('change',()=>{
      this.draft.tableAnchor={position:['anchor-x','anchor-y','anchor-z'].map(id=>Number($<HTMLInputElement>(id).value)) as [number,number,number],yawDeg:Number($<HTMLInputElement>('anchor-yaw').value)};
      this.draft.tableEnvelope.maxStraightLength=Number($<HTMLInputElement>('studio-capacity').value);this.changed();
    });
    $('studio-json-load').onclick=()=>{try{this.draft=validateStudioScene(JSON.parse($<HTMLTextAreaElement>('studio-json').value));this.changed();}catch(e){this.report(e);}};
    $('studio-json-export').onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(this.draft,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='scene.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    for(const id of ['set-enabled','set-title','set-subtitle'])$(id).addEventListener('change',()=>{this.draft.broadcast={enabled:$<HTMLInputElement>('set-enabled').checked,title:$<HTMLInputElement>('set-title').value,subtitle:$<HTMLInputElement>('set-subtitle').value};this.changed();});
    $('studio-fit').onclick=()=>{if(this.visual)this.preview?.fit(this.visual.root);};
  }
  open():void{
    if(this.busy||this.dialog.open||!this.client.state)return;
    this.revision=this.client.state.revision;this.draft=structuredClone(this.client.state.studio);this.files=[];
    this.dialog.showModal();this.preview=new PreviewStage($<HTMLCanvasElement>('studio-preview'));
    this.visual=new StudioVisual(this.client,this.preview.renderer);this.preview.scene.add(this.visual.root);
    this.preview.onFrame=()=>{const length=this.client.state?.straightLength??3;const z=this.client.state?.deskOffsetZ??0;this.visual?.setLength(length,z);this.preview?.table.update(length);if(this.preview){const a=this.draft.tableAnchor;this.preview.table.position.set(a.position[0]+Math.sin(a.yawDeg*Math.PI/180)*z,a.position[1],a.position[2]+Math.cos(a.yawDeg*Math.PI/180)*z);}if(this.preview){this.preview.exposureSettings=this.draft.exposure??DEFAULT_EXPOSURE;this.preview.qualitySettings=this.draft.quality??DEFAULT_QUALITY;this.preview.authoredLights=this.visual?.root.visible?this.visual.authoredLights:0;this.preview.exposureSource=String(this.visual?.renderGeneration??0);}};
    this.changed();
  }
  private id(prefix:string):string{let i=1;while(this.draft.objects.some(o=>o.id===prefix+'_'+i))i++;return prefix+'_'+i;}
  private add(object:StudioObject):void{this.draft.objects.push(object);this.selected=object.id;this.changed();}
  private selectFiles(files:FileList|null):void{
    this.files=files?[...files]:[];const entries=this.files.filter(f=>/\.(gltf|glb)$/i.test(f.name));
    $<HTMLInputElement>('studio-entry').value=entries.length===1?(entries[0]!.webkitRelativePath||entries[0]!.name):'';
    $('studio-feedback').textContent=`${this.files.length}ファイルを選択しました。取り込み後も「適用」するまで映像は変わりません。`;
  }
  private lock(value:boolean):void{this.busy=value;for(const e of this.dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement|HTMLTextAreaElement>('input,button,select,textarea'))e.disabled=value;
    if(!value)$<HTMLButtonElement>('studio-apply').disabled=!this.visual||this.visual.loading||!!this.visual.error;
  }
  private report(error:unknown):void{const code=error instanceof Error?error.message:'STUDIO_FAILED';$('studio-feedback').textContent=code;$('studio-feedback').dataset.errorCode=code;}
  private async import():Promise<void>{
    if(this.busy||!this.files.length)return;this.lock(true);
    try{
      const bundle=await this.client.importStudio(this.files,$<HTMLInputElement>('studio-entry').value||undefined);
      this.add({id:this.id('model'),kind:'model',bundleId:bundle.bundleId,transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}});
    }catch(e){this.report(e);}finally{this.lock(false);}
  }
  private fields():void{
    $<HTMLInputElement>('set-enabled').checked=this.draft.broadcast?.enabled??false;$<HTMLInputElement>('set-title').value=this.draft.broadcast?.title??'円卓討論';$<HTMLInputElement>('set-subtitle').value=this.draft.broadcast?.subtitle??'ENTAKU STUDIO';
    const select=$<HTMLSelectElement>('studio-object');select.replaceChildren();
    for(const o of this.draft.objects){const option=document.createElement('option');option.value=o.id;option.textContent=`${o.id} (${o.kind})`;select.append(option);}
    if(!this.draft.objects.some(o=>o.id===this.selected))this.selected=this.draft.objects[0]?.id??'';select.value=this.selected;
    const o=this.draft.objects.find(o=>o.id===this.selected);
    const pos=o?('transform'in o?o.transform.position:o.position):[0,0,0];
    positionFields.forEach((id,i)=>{$<HTMLInputElement>(id).value=String(pos[i]);});
    scaleFields.forEach((id,i)=>{$<HTMLInputElement>(id).value=String(o&&'transform'in o?o.transform.scale[i]:1);});
    $<HTMLInputElement>('studio-yaw').value=String(o&&'transform'in o?o.transform.yawDeg:0);
    ['anchor-x','anchor-y','anchor-z'].forEach((id,i)=>{$<HTMLInputElement>(id).value=String(this.draft.tableAnchor.position[i]);});
    $<HTMLInputElement>('anchor-yaw').value=String(this.draft.tableAnchor.yawDeg);
    $<HTMLInputElement>('studio-capacity').value=String(this.draft.tableEnvelope.maxStraightLength);
  }
  private move():void{
    const o=this.draft.objects.find(o=>o.id===this.selected);if(!o)return;
    const position=positionFields.map(id=>Number($<HTMLInputElement>(id).value)) as [number,number,number];
    if('transform'in o)o.transform={position,yawDeg:Number($<HTMLInputElement>('studio-yaw').value),scale:scaleFields.map(id=>Number($<HTMLInputElement>(id).value)) as [number,number,number]};
    else o.position=position;this.changed();
  }
  private changed():void{
    try{
      this.draft=validateStudioScene(this.draft);this.fields();
      $<HTMLTextAreaElement>('studio-json').value=JSON.stringify(this.draft,null,2);
      const anchor=this.draft.tableAnchor;
      this.preview?.table.position.fromArray(anchor.position);if(this.preview)this.preview.table.rotation.y=anchor.yawDeg*Math.PI/180;
      $('studio-feedback').dataset.errorCode='';$('studio-feedback').textContent='プレビューを読み込み中です。';
      $<HTMLButtonElement>('studio-apply').disabled=true;
      const generation=++this.generation;
      void this.visual?.update(this.draft).then(()=>{
        if(generation!==this.generation)return;
        if(this.visual?.error)this.report(new Error(this.visual.error));
        else{$('studio-feedback').textContent='プレビューの内容を確認して「適用」してください。';$<HTMLButtonElement>('studio-apply').disabled=this.busy;}
      });
    }catch(e){this.report(e);$<HTMLButtonElement>('studio-apply').disabled=true;}
  }
  private async apply():Promise<void>{
    if(this.busy||this.visual?.loading||this.visual?.error)return;this.lock(true);
    try{await this.client.command({type:'studio-set',scene:validateStudioScene(this.draft)},this.revision);this.dialog.close();}
    catch(e){this.report(e);}finally{this.lock(false);}
  }
}
