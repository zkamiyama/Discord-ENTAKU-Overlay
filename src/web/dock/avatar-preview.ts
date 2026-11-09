import {PreviewStage} from '../studio/preview.ts';
import {CustomAvatarVisual} from '../overlay/custom-avatar.ts';
import {loadImagePair} from '../shared/image-pair.ts';
import type {AvatarProfile} from '../../assets/avatar-profile.ts';

export interface PreviewDependencies {
 stage:(canvas:HTMLCanvasElement)=>PreviewStage;
 build:typeof CustomAvatarVisual.create;
 copy:(image:ImageBitmap)=>Promise<ImageBitmap>;
 delayMs:number;
}
const defaults:PreviewDependencies={stage:canvas=>new PreviewStage(canvas),build:CustomAvatarVisual.create,copy:image=>createImageBitmap(image),delayMs:150};
/** One editor owns one preview. Drafts never mutate the program scene, and an
 * obsolete build cannot publish after a newer edit or after the dialog closes. */
export class AvatarPreview {
 private stage:PreviewStage;
 private visual:CustomAvatarVisual|null=null;
 private generation=0;
 private timer?:ReturnType<typeof setTimeout>;
 private closed=false;
 private signature='';
 private image?:ImageBitmap;
 private back?:ImageBitmap;
 pending=false;
 constructor(canvas:HTMLCanvasElement,private changed:(error?:unknown)=>void,glowScale:()=>number,private deps:PreviewDependencies=defaults){
  this.stage=deps.stage(canvas);
  // Calibration needs shape, desk clearance and back art, not a second full
  // SSR/GTAO/SSGI pipeline alongside OBS. Native renderer antialiasing stays on.
  this.stage.qualitySettings={...this.stage.qualitySettings,shadows:'off',ao:'off',reflections:false,gi:'off',fxaa:false,msaa:0};
  this.stage.postSettings={...this.stage.postSettings,enabled:false};
  this.stage.controls.target.set(0,1.25,3.4);this.stage.camera.position.set(0,1.7,1.5);this.stage.controls.update();
  this.stage.onFrame=()=>this.visual?.update(1,.85+.15*Math.sin(performance.now()*.006),0,glowScale());
 }
 update(image:ImageBitmap,profile:AvatarProfile,back?:ImageBitmap):void {
  if(this.closed)return;
  const signature=JSON.stringify(profile);
  if(this.image===image&&this.back===back&&this.signature===signature)return;
  this.cancel();this.image=image;this.back=back;this.signature=signature;
  const version=this.generation;this.pending=true;this.changed();
  const clean=structuredClone(profile);
  this.timer=setTimeout(()=>void this.build(version,image,clean,back),this.deps.delayMs);
 }
 cancel():void {
  this.generation++;clearTimeout(this.timer);this.timer=undefined;
  this.pending=false;this.signature='';this.image=this.back=undefined;
 }
 private async build(version:number,image:ImageBitmap,profile:AvatarProfile,back?:ImageBitmap):Promise<void>{
  let copies:[ImageBitmap,ImageBitmap|undefined]|undefined;
  try{
   // Own copies across the worker await. The editor may close or replace originals.
   copies=await loadImagePair(this.deps.copy(image),back?this.deps.copy(back):undefined);
   if(version!==this.generation||this.closed)return;
   const visual=await this.deps.build(copies[0],profile,copies[1]);
   if(version!==this.generation||this.closed){visual.dispose();return;}
   visual.root.position.set(-profile.offsetX,1.25+profile.offsetY,3.4);visual.root.rotation.y=Math.PI;
   this.stage.scene.add(visual.root);this.visual?.dispose();this.visual=visual;this.pending=false;this.changed();
  }catch(error){if(version===this.generation&&!this.closed){this.pending=false;this.signature='';this.changed(error);}}
  finally{copies?.[0].close();copies?.[1]?.close();}
 }
 dispose():void {
  if(this.closed)return;this.closed=true;this.cancel();this.visual?.dispose();this.visual=null;this.stage.dispose();
 }
}
