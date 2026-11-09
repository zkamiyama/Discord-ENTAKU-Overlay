import {fitImage,imagePoint} from './image-selection.ts';
import {loadAvatarImage} from './avatar-image.ts';
import {syncNumericControls} from './numeric-controls.ts';
import { loadImagePair } from '../shared/image-pair.ts';
import {AvatarPreview} from './avatar-preview.ts';
import { avatarBounds, validateProfile, type AvatarProfile, type FaceRect } from '../../assets/avatar-profile.ts';
import type { StoredImage } from '../../assets/store.ts';
import { StudioClient } from '../shared/client.ts';
const messages: Record<string,string> = {
  IMAGE_TOO_LARGE:'画像は20MiB以下にしてください。', IMAGE_DIMENSIONS_REJECTED:'画像の縦横は4096px以下にしてください。',
  IMAGE_FORMAT_REJECTED:'PNGまたは静止WebPを選んでください。', ANIMATED_IMAGE_REJECTED:'アニメーション画像には対応していません。',
  INVALID_IMAGE:'画像の形式が正しくありません。別の画像を書き出してください。', INVALID_FACE_RECT:'顔の矩形を画像の中に指定してください。',
  FACE_RECT_TOO_SMALL:'顔の矩形は縦横4px以上にしてください。', INVALID_AVATAR_TRANSFORM:'倍率と位置を設定範囲内にしてください。',
  AVATAR_TOO_WIDE:'顔位置を基準とした左右の占有幅が2.8mを超えます。余白・倍率・横位置を調整してください。',
  AVATAR_TOO_TALL:'画像が高すぎます。余白・倍率・縦位置を調整してください。',
  REVISION_CONFLICT:'編集中に別の設定操作がありました。閉じて開き直すと現在の設定を取得します。',
  AVATAR_SETTINGS_WRITE_FAILED:'設定を保存できませんでした。保存先を確認してください。以前の設定は保持しています。',
  ASSET_NOT_FOUND:'保存済みの画像を読み込めません。画像を選び直してください。', ASSET_STORE_FULL:'素材の保存上限に達しました。', EMPTY_AVATAR_IMAGE:'不透明な部分のある画像を選んでください。',
};
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
export class AvatarEditor {
  private dialog = $<HTMLDialogElement>('avatar-editor');
  private canvas = $<HTMLCanvasElement>('avatar-preview');
  private bitmap:ImageBitmap|null=null;
  private backBitmap:ImageBitmap|null=null;
  private backImage:StoredImage|null=null;
  private backFit={x:0,y:0,w:1,h:1};
  private preview:AvatarPreview|null=null;
  private get previewPending():boolean{return this.preview?.pending??false;}
  private image:StoredImage|null=null;
  private userId=''; private revision=0; private generation=0; private busy=false;
  private drag: {x:number;y:number;pointer:number}|null=null;
  private fit={x:0,y:0,w:1,h:1};
  private fields=['face-x','face-y','face-w','face-h','avatar-scale','avatar-offset-x','avatar-offset-y','back-face-x','back-face-y','back-face-w','back-face-h','frame-x','frame-y','frame-w','frame-h','avatar-frame-enable'];
  constructor(private client:StudioClient){
    this.dialog.addEventListener('close',()=>{this.generation++;this.preview?.dispose();this.preview=null;this.bitmap?.close();this.backBitmap?.close();this.bitmap=this.backBitmap=null;this.image=this.backImage=null;});
    this.dialog.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});
    $('avatar-cancel').onclick=()=>{if(!this.busy)this.dialog.close();};
    $<HTMLFormElement>('avatar-form').onsubmit=e=>{e.preventDefault();void this.apply();};
    $('avatar-reset').onclick=()=>{if(confirm('この人のカスタム画像を解除してDiscordアイコンへ戻しますか？'))void this.reset();};
    $<HTMLInputElement>('avatar-file').onchange=()=>{const file=$<HTMLInputElement>('avatar-file').files?.[0];if(file)void this.select(file);};
    $<HTMLInputElement>('avatar-back-file').onchange=()=>{const file=$<HTMLInputElement>('avatar-back-file').files?.[0];if(file)void this.selectBack(file);};
    $('avatar-back-remove').onclick=()=>{this.backBitmap?.close();this.backBitmap=null;this.backImage=null;this.draw();};
    const backCanvas=$<HTMLCanvasElement>('avatar-back-preview');let backDrag:{x:number;y:number;pointer:number}|null=null;
    const point=(event:PointerEvent)=>imagePoint(event.clientX,event.clientY,backCanvas.getBoundingClientRect(),480,480,this.backFit);
    backCanvas.onpointerdown=e=>{if(this.busy||!this.backImage)return;backDrag={...point(e),pointer:e.pointerId};backCanvas.setPointerCapture(e.pointerId);};
    backCanvas.onpointermove=e=>{if(!backDrag||e.pointerId!==backDrag.pointer)return;const p=point(e),d=backDrag;this.setNamedRect('back-face',[Math.min(p.x,d.x),Math.min(p.y,d.y),Math.abs(p.x-d.x),Math.abs(p.y-d.y)]);this.draw();};
    backCanvas.onpointerup=e=>{if(backDrag?.pointer===e.pointerId){backDrag=null;backCanvas.releasePointerCapture(e.pointerId);this.draw();}};
    backCanvas.onpointercancel=()=>{backDrag=null;};
    for(const field of this.fields)$(field).addEventListener('input',()=>this.draw());
    this.canvas.onpointerdown=event=>{
      if(this.busy||!this.image)return;
      const point=this.point(event);this.drag={...point,pointer:event.pointerId};this.canvas.setPointerCapture(event.pointerId);
    };
    this.canvas.onpointermove=event=>{
      if(!this.drag||event.pointerId!==this.drag.pointer)return;
      const p=this.point(event),d=this.drag;
      this.setNamedRect($<HTMLSelectElement>('avatar-selection-target').value==='frame'?'frame':'face',[Math.min(d.x,p.x),Math.min(d.y,p.y),Math.abs(d.x-p.x),Math.abs(d.y-p.y)]);this.draw();
    };
    this.canvas.onpointerup=event=>{if(this.drag?.pointer===event.pointerId){this.drag=null;this.canvas.releasePointerCapture(event.pointerId);this.draw();}};
    this.canvas.onpointercancel=()=>{this.drag=null;};
  }
  async open(userId:string,name:string):Promise<void>{
    if(this.busy||this.dialog.open||!this.client.state)return;
    this.userId=userId;this.revision=this.client.state.revision;this.image=null;this.bitmap=null;this.backImage=null;this.backBitmap=null;
    $('avatar-person').textContent=name; $<HTMLInputElement>('avatar-file').value='';
    const profile=this.client.state.avatarProfiles.find(p=>p.userId===userId);
    this.setRect(profile?.faceRect??[.25,.1,.5,.25]);
    $<HTMLInputElement>('avatar-scale').value=String(profile?.scale??1);
    $<HTMLInputElement>('avatar-offset-x').value=String(profile?.offsetX??0);
    $<HTMLInputElement>('avatar-offset-y').value=String(profile?.offsetY??0);
    this.setNamedRect('back-face',profile?.back?.faceRect??[.25,.1,.5,.25]);
    this.setNamedRect('frame',profile?.framingRect??[0,0,1,1]);
    $<HTMLInputElement>('avatar-frame-enable').checked=!!profile?.framingRect;
    $<HTMLSelectElement>('avatar-selection-target').value='face';$<HTMLInputElement>('avatar-back-file').value='';
    this.feedback('');this.dialog.showModal();
    this.preview=new AvatarPreview($<HTMLCanvasElement>('avatar-3d-preview'),error=>{
      if(error){this.report(error);$<HTMLButtonElement>('avatar-apply').disabled=true;}
      else $<HTMLButtonElement>('avatar-apply').disabled=this.busy||this.previewPending||!this.validDraft();
    },()=>this.client.state?.studio.post?.speechGlowScale??4);this.draw();
    if(profile){
      const version=++this.generation;this.setBusy(true);
      try{
        const [bitmap,back]=await loadImagePair(this.client.customImage(profile.assetId),profile.back?this.client.customImage(profile.back.assetId):undefined);
        if(version!==this.generation){bitmap.close();back?.close();return;}
        if(back&&profile.back){this.backBitmap=back;this.backImage={...profile.back.image,assetId:profile.back.assetId,byteLength:0};}
        this.bitmap=bitmap;this.image={...profile.image,assetId:profile.assetId,byteLength:0};
      }catch(e){this.report(e);}finally{this.setBusy(false);this.draw();}
    }
  }
  private setBusy(value:boolean):void{
    this.busy=value;
    for(const e of this.dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))e.disabled=value;
    if(!value)$<HTMLButtonElement>('avatar-apply').disabled=this.previewPending||!this.validDraft();syncNumericControls();
  }
  private feedback(text:string,code=''):void{delete $('avatar-feedback').dataset.validation;$('avatar-feedback').textContent=text;$('avatar-feedback').dataset.errorCode=code;}
  private report(error:unknown):void{const code=error instanceof Error?error.message:'AVATAR_EDIT_FAILED';this.feedback(messages[code]??'画像を読み込み・保存できませんでした。',code);}
  private setNamedRect(prefix:string,rect:FaceRect):void{['x','y','w','h'].forEach((name,i)=>{$<HTMLInputElement>(prefix+'-'+name).value=(rect[i]!*100).toFixed(3);});}
  private setRect(rect:FaceRect):void{this.setNamedRect('face',rect);}
  private getRect(prefix:string):FaceRect{return ['x','y','w','h'].map(name=>Number($<HTMLInputElement>(prefix+'-'+name).value)/100) as unknown as FaceRect;}
  private draft():AvatarProfile{
    if(!this.image)throw new Error('IMAGE_REQUIRED');
    return {userId:this.userId,assetId:this.image.assetId,image:{width:this.image.width,height:this.image.height,mime:this.image.mime},
      faceRect:['face-x','face-y','face-w','face-h'].map(id=>Number($<HTMLInputElement>(id).value)/100) as unknown as FaceRect,
      scale:Number($<HTMLInputElement>('avatar-scale').value),offsetX:Number($<HTMLInputElement>('avatar-offset-x').value),offsetY:Number($<HTMLInputElement>('avatar-offset-y').value),
      ...(this.backImage?{back:{assetId:this.backImage.assetId,image:{width:this.backImage.width,height:this.backImage.height,mime:this.backImage.mime},faceRect:this.getRect('back-face')}}:{}),
      ...($<HTMLInputElement>('avatar-frame-enable').checked?{framingRect:this.getRect('frame')}:{})};
  }
  private validDraft():boolean{try{validateProfile(this.draft());return true;}catch{return false;}}
  private point(event:PointerEvent):{x:number;y:number}{
    return imagePoint(event.clientX,event.clientY,this.canvas.getBoundingClientRect(),this.canvas.width,this.canvas.height,this.fit);
  }
  private async select(file:File):Promise<void>{
    if(this.busy)return;this.setBusy(true);this.feedback('画像を検証しています。');
    const version=++this.generation;
    try{
      const {image,bitmap}=await loadAvatarImage(this.client,file,true);
      if(version!==this.generation){bitmap.close();return;}
      this.bitmap?.close();this.bitmap=bitmap;this.image=image;this.feedback('顔を矩形で囲んでください。「適用」するまで映像は変わりません。');
    }catch(e){this.report(e);}finally{this.setBusy(false);this.draw();}
  }
  private async selectBack(file:File):Promise<void>{
    if(this.busy)return;this.setBusy(true);const version=++this.generation;
    try{
      const {image,bitmap}=await loadAvatarImage(this.client,file,false);
      if(version!==this.generation){bitmap.close();return;}
      this.backBitmap?.close();this.backBitmap=bitmap;this.backImage=image;this.feedback('背面の顔も矩形で指定してください。');
    }catch(e){this.report(e);}finally{this.setBusy(false);this.draw();}
  }
  private updatePreview():void{
    if(!this.bitmap||!this.preview||!this.validDraft()){this.preview?.cancel();return;}
    this.preview.update(this.bitmap,validateProfile(this.draft()),this.backBitmap??undefined);
    $<HTMLButtonElement>('avatar-apply').disabled=this.busy||this.previewPending;
  }
  private drawBack():void{
    const canvas=$<HTMLCanvasElement>('avatar-back-preview');canvas.hidden=!this.backBitmap;
    if(!this.backBitmap)return;
    const c=canvas.getContext('2d')!,w=480,h=480;c.fillStyle='#202c3c';c.fillRect(0,0,w,h);
    this.backFit=fitImage(this.backBitmap.width,this.backBitmap.height,w,h);
    const f=this.backFit,r=this.getRect('back-face');c.drawImage(this.backBitmap,f.x,f.y,f.w,f.h);c.strokeStyle='#70f1ad';c.lineWidth=2;c.strokeRect(f.x+r[0]*f.w,f.y+r[1]*f.h,r[2]*f.w,r[3]*f.h);
  }
  private draw():void{
    syncNumericControls();
    this.drawBack();
    const context=this.canvas.getContext('2d')!,w=this.canvas.width,h=this.canvas.height;
    for(let y=0;y<h;y+=20)for(let x=0;x<w;x+=20){context.fillStyle=((x+y)/20)%2?'#253245':'#1b2636';context.fillRect(x,y,20,20);}
    if(!this.bitmap||!this.image){$('avatar-size').textContent='PNG / 静止WebP · 最大4096×4096px / 20MiB';$<HTMLButtonElement>('avatar-apply').disabled=true;return;}
    this.fit=fitImage(this.bitmap.width,this.bitmap.height,w,h);
    const f=this.fit;context.drawImage(this.bitmap,f.x,f.y,f.w,f.h);
    const draft=this.draft(),r=draft.faceRect;
    context.strokeStyle='#70f1ad';context.lineWidth=2;context.strokeRect(f.x+r[0]*f.w,f.y+r[1]*f.h,r[2]*f.w,r[3]*f.h);
    if(draft.framingRect){const r=draft.framingRect;context.strokeStyle='#f3cb6d';context.strokeRect(f.x+r[0]*f.w,f.y+r[1]*f.h,r[2]*f.w,r[3]*f.h);}
    const b=avatarBounds(draft);
    $('avatar-size').textContent=`${this.image.width}×${this.image.height}px · 幅 ${(100*(b.right-b.left)).toFixed(1)}cm · 顔高 ${(28*draft.scale).toFixed(1)}cm`;
    try{validateProfile(draft);if($('avatar-feedback').dataset.validation==='true'){this.feedback('「適用」するまで映像は変わりません。');delete $('avatar-feedback').dataset.validation;}}
    catch(e){this.report(e);$('avatar-feedback').dataset.validation='true';}
    $<HTMLButtonElement>('avatar-apply').disabled=this.busy||!this.validDraft();this.updatePreview();
  }
  private async apply():Promise<void>{
    if(this.busy||this.previewPending)return;this.setBusy(true);
    try{const profile=validateProfile(this.draft());await this.client.command({type:'avatar-set',profile},this.revision);this.dialog.close();}
    catch(e){this.report(e);}finally{this.setBusy(false);}
  }
  private async reset():Promise<void>{
    if(this.busy)return;this.setBusy(true);
    try{await this.client.command({type:'avatar-reset',userId:this.userId},this.revision);this.dialog.close();}
    catch(e){this.report(e);}finally{this.setBusy(false);}
  }
}
