import { avatarBounds, validateProfile, type AvatarProfile, type FaceRect } from '../../assets/avatar-profile.ts';
import type { StoredImage } from '../../assets/store.ts';
import { MAX_IMAGE_BYTES } from '../../assets/image.ts';
import { StudioClient } from '../shared/client.ts';
const messages: Record<string,string> = {
  IMAGE_TOO_LARGE:'画像は20MiB以下にしてください。', IMAGE_DIMENSIONS_REJECTED:'画像の縦横は4096px以下にしてください。',
  IMAGE_FORMAT_REJECTED:'PNGまたは静止WebPを選んでください。', ANIMATED_IMAGE_REJECTED:'アニメーション画像には対応していません。',
  INVALID_IMAGE:'画像の形式が正しくありません。別の画像を書き出してください。', INVALID_FACE_RECT:'顔の矩形を画像の中に指定してください。',
  FACE_RECT_TOO_SMALL:'顔の矩形は縦横4px以上にしてください。', INVALID_AVATAR_TRANSFORM:'倍率と位置を設定範囲内にしてください。',
  AVATAR_TOO_WIDE:'顔位置を基準とした左右の占有幅が席間隔を超えます。余白・倍率・横位置を調整してください。',
  AVATAR_TOO_TALL:'画像が高すぎます。余白・倍率・縦位置を調整してください。',
  REVISION_CONFLICT:'編集中に別の設定操作がありました。閉じて開き直すと現在の設定を取得します。',
  AVATAR_SETTINGS_WRITE_FAILED:'設定を保存できませんでした。保存先を確認してください。以前の設定は保持しています。',
  ASSET_STORE_FULL:'素材の保存上限に達しました。', EMPTY_AVATAR_IMAGE:'不透明な部分のある画像を選んでください。',
};
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
export class AvatarEditor {
  private dialog = $<HTMLDialogElement>('avatar-editor');
  private canvas = $<HTMLCanvasElement>('avatar-preview');
  private bitmap:ImageBitmap|null=null;
  private image:StoredImage|null=null;
  private userId=''; private revision=0; private generation=0; private busy=false;
  private drag: {x:number;y:number;pointer:number}|null=null;
  private fit={x:0,y:0,w:1,h:1};
  private fields=['face-x','face-y','face-w','face-h','avatar-scale','avatar-offset-x','avatar-offset-y'];
  constructor(private client:StudioClient){
    this.dialog.addEventListener('close',()=>{this.generation++;this.bitmap?.close();this.bitmap=null;this.image=null;});
    this.dialog.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});
    $('avatar-cancel').onclick=()=>{if(!this.busy)this.dialog.close();};
    $<HTMLFormElement>('avatar-form').onsubmit=e=>{e.preventDefault();void this.apply();};
    $('avatar-reset').onclick=()=>{if(confirm('この人のカスタム画像を解除してDiscordアイコンへ戻しますか？'))void this.reset();};
    $<HTMLInputElement>('avatar-file').onchange=()=>{const file=$<HTMLInputElement>('avatar-file').files?.[0];if(file)void this.select(file);};
    for(const field of this.fields)$(field).addEventListener('input',()=>this.draw());
    this.canvas.onpointerdown=event=>{
      if(this.busy||!this.image)return;
      const point=this.point(event);this.drag={...point,pointer:event.pointerId};this.canvas.setPointerCapture(event.pointerId);
    };
    this.canvas.onpointermove=event=>{
      if(!this.drag||event.pointerId!==this.drag.pointer)return;
      const p=this.point(event),d=this.drag;
      this.setRect([Math.min(d.x,p.x),Math.min(d.y,p.y),Math.abs(d.x-p.x),Math.abs(d.y-p.y)]);this.draw();
    };
    this.canvas.onpointerup=event=>{if(this.drag?.pointer===event.pointerId){this.drag=null;this.canvas.releasePointerCapture(event.pointerId);this.draw();}};
    this.canvas.onpointercancel=()=>{this.drag=null;};
  }
  async open(userId:string,name:string):Promise<void>{
    if(this.busy||!this.client.state)return;
    if(this.dialog.open)this.dialog.close();
    this.userId=userId;this.revision=this.client.state.revision;this.image=null;this.bitmap=null;
    $('avatar-person').textContent=name; $<HTMLInputElement>('avatar-file').value='';
    const profile=this.client.state.avatarProfiles.find(p=>p.userId===userId);
    this.setRect(profile?.faceRect??[.25,.1,.5,.25]);
    $<HTMLInputElement>('avatar-scale').value=String(profile?.scale??1);
    $<HTMLInputElement>('avatar-offset-x').value=String(profile?.offsetX??0);
    $<HTMLInputElement>('avatar-offset-y').value=String(profile?.offsetY??0);
    this.feedback('');this.dialog.showModal();this.draw();
    if(profile){
      const version=++this.generation;this.setBusy(true);
      try{
        const bitmap=await this.client.customImage(profile.assetId);
        if(version!==this.generation){bitmap.close();return;}
        this.bitmap=bitmap;this.image={...profile.image,assetId:profile.assetId,byteLength:0};
      }catch(e){this.report(e);}finally{this.setBusy(false);this.draw();}
    }
  }
  private setBusy(value:boolean):void{
    this.busy=value;
    for(const e of this.dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))e.disabled=value;
    if(!value)$<HTMLButtonElement>('avatar-apply').disabled=!this.validDraft();
  }
  private feedback(text:string,code=''):void{delete $('avatar-feedback').dataset.validation;$('avatar-feedback').textContent=text;$('avatar-feedback').dataset.errorCode=code;}
  private report(error:unknown):void{const code=error instanceof Error?error.message:'AVATAR_EDIT_FAILED';this.feedback(messages[code]??'画像を読み込み・保存できませんでした。',code);}
  private setRect(rect:FaceRect):void{['face-x','face-y','face-w','face-h'].forEach((name,i)=>{$<HTMLInputElement>(name).value=(rect[i]!*100).toFixed(3);});}
  private draft():AvatarProfile{
    if(!this.image)throw new Error('IMAGE_REQUIRED');
    return {userId:this.userId,assetId:this.image.assetId,image:{width:this.image.width,height:this.image.height,mime:this.image.mime},
      faceRect:['face-x','face-y','face-w','face-h'].map(id=>Number($<HTMLInputElement>(id).value)/100) as unknown as FaceRect,
      scale:Number($<HTMLInputElement>('avatar-scale').value),offsetX:Number($<HTMLInputElement>('avatar-offset-x').value),offsetY:Number($<HTMLInputElement>('avatar-offset-y').value)};
  }
  private validDraft():boolean{try{validateProfile(this.draft());return true;}catch{return false;}}
  private point(event:PointerEvent):{x:number;y:number}{
    const bounds=this.canvas.getBoundingClientRect(),x=(event.clientX-bounds.left)*this.canvas.width/bounds.width,y=(event.clientY-bounds.top)*this.canvas.height/bounds.height;
    return {x:Math.max(0,Math.min(1,(x-this.fit.x)/this.fit.w)),y:Math.max(0,Math.min(1,(y-this.fit.y)/this.fit.h))};
  }
  private async select(file:File):Promise<void>{
    if(this.busy)return;this.setBusy(true);this.feedback('画像を検証しています。');
    const version=++this.generation;
    try{
      if(file.size>MAX_IMAGE_BYTES)throw new Error('IMAGE_TOO_LARGE');
      // Server checks size and dimensions before the browser invokes its image decoder.
      const image=await this.client.importImage(file);
      const bitmap=await createImageBitmap(file);
      if(version!==this.generation){bitmap.close();return;}
      if(bitmap.width!==image.width||bitmap.height!==image.height){bitmap.close();throw new Error('INVALID_IMAGE');}
      const check=document.createElement('canvas');check.width=Math.min(256,bitmap.width);check.height=Math.max(1,Math.round(bitmap.height*check.width/bitmap.width));
      const context=check.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,0,0,check.width,check.height);
      const pixels=context.getImageData(0,0,check.width,check.height).data;
      if(!pixels.some((value,index)=>index%4===3&&value>=128)){bitmap.close();throw new Error('EMPTY_AVATAR_IMAGE');}
      this.bitmap?.close();this.bitmap=bitmap;this.image=image;this.feedback('顔を矩形で囲んでください。「適用」するまで映像は変わりません。');
    }catch(e){this.report(e);}finally{this.setBusy(false);this.draw();}
  }
  private draw():void{
    const context=this.canvas.getContext('2d')!,w=this.canvas.width,h=this.canvas.height;
    for(let y=0;y<h;y+=20)for(let x=0;x<w;x+=20){context.fillStyle=((x+y)/20)%2?'#253245':'#1b2636';context.fillRect(x,y,20,20);}
    if(!this.bitmap||!this.image){$('avatar-size').textContent='PNG / 静止WebP · 最大4096×4096px / 20MiB';$<HTMLButtonElement>('avatar-apply').disabled=true;return;}
    const scale=Math.min((w-32)/this.bitmap.width,(h-32)/this.bitmap.height);
    this.fit={x:(w-this.bitmap.width*scale)/2,y:(h-this.bitmap.height*scale)/2,w:this.bitmap.width*scale,h:this.bitmap.height*scale};
    const f=this.fit;context.drawImage(this.bitmap,f.x,f.y,f.w,f.h);
    const draft=this.draft(),r=draft.faceRect;
    context.strokeStyle='#70f1ad';context.lineWidth=2;context.strokeRect(f.x+r[0]*f.w,f.y+r[1]*f.h,r[2]*f.w,r[3]*f.h);
    const b=avatarBounds(draft);
    $('avatar-size').textContent=`${this.image.width}×${this.image.height}px · 幅 ${(100*(b.right-b.left)).toFixed(1)}cm · 顔高 ${(28*draft.scale).toFixed(1)}cm`;
    try{validateProfile(draft);if($('avatar-feedback').dataset.validation==='true'){this.feedback('「適用」するまで映像は変わりません。');delete $('avatar-feedback').dataset.validation;}}
    catch(e){this.report(e);$('avatar-feedback').dataset.validation='true';}
    $<HTMLButtonElement>('avatar-apply').disabled=this.busy||!this.validDraft();
  }
  private async apply():Promise<void>{
    if(this.busy)return;this.setBusy(true);
    try{const profile=validateProfile(this.draft());await this.client.command({type:'avatar-set',profile},this.revision);this.dialog.close();}
    catch(e){this.report(e);}finally{this.setBusy(false);}
  }
  private async reset():Promise<void>{
    if(this.busy)return;this.setBusy(true);
    try{await this.client.command({type:'avatar-reset',userId:this.userId},this.revision);this.dialog.close();}
    catch(e){this.report(e);}finally{this.setBusy(false);}
  }
}
