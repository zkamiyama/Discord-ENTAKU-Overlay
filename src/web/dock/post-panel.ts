import {SettingForm} from './setting-form.ts';
import {numericEditing} from './numeric-controls.ts';
import {DEFAULT_POST,validatePost,type PostSettings} from '../../studio/post-effects.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioClient} from '../shared/client.ts';
const get=(id:string)=>document.getElementById(id) as HTMLInputElement;
const fields:Record<string,keyof PostSettings>={'post-enabled':'enabled','post-exclude':'excludeAvatars','post-saturation':'saturation','post-contrast':'contrast','post-bloom':'bloom','post-bloom-threshold':'bloomThreshold','post-bloom-strength':'bloomStrength','post-bloom-radius':'bloomRadius','post-dof':'dof','post-focus-mode':'focusMode','post-focus-offset':'focusOffset','post-focus-distance':'focusDistance','post-focus-range':'focusRange','post-aperture':'aperture','post-max-blur':'maxBlur','post-speech-glow':'speechGlowScale'};
export class PostPanel {
 private form:SettingForm<'post'>;
 private get busy(){return this.form.busy;}
 constructor(client:StudioClient){
  this.form=new SettingForm(client,'post',validatePost,'#post-controls input,#post-controls select,#post-controls button','post-message',s=>this.update(s));
  for(const id of Object.keys(fields))get(id).addEventListener('change',()=>void this.apply());
  get('post-reset').onclick=()=>void this.save({...DEFAULT_POST});

 }
 update(state:AppSnapshot):void{
  if(this.busy)return;const p=state.studio.post??DEFAULT_POST;
  for(const [id,key]of Object.entries(fields)){const node=get(id);if(typeof p[key]==='boolean')node.checked=p[key] as boolean;else if(!numericEditing(node))node.value=String(p[key]);}
 }
 private apply():Promise<void>{const p:Record<string,unknown>={};for(const [id,key]of Object.entries(fields)){const input=get(id);p[key]=typeof DEFAULT_POST[key]==='boolean'?input.checked:typeof DEFAULT_POST[key]==='number'?Number(input.value):input.value;}return this.save(p);}
 private save(value:unknown):Promise<void>{return this.form.save(value);}
}
