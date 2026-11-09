import {DEFAULT_POST,NATURAL_POST,validatePost,type PostSettings} from '../../studio/post-effects.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioClient} from '../shared/client.ts';
const get=(id:string)=>document.getElementById(id) as HTMLInputElement;
const fields:Record<string,keyof PostSettings>={'post-enabled':'enabled','post-exclude':'excludeAvatars','post-saturation':'saturation','post-contrast':'contrast','post-bloom':'bloom','post-bloom-threshold':'bloomThreshold','post-bloom-strength':'bloomStrength','post-bloom-radius':'bloomRadius','post-dof':'dof','post-focus-mode':'focusMode','post-focus-offset':'focusOffset','post-focus-distance':'focusDistance','post-focus-range':'focusRange','post-aperture':'aperture','post-max-blur':'maxBlur','post-speech-glow':'speechGlowScale'};
export class PostPanel {
 private busy=false;
 constructor(private client:StudioClient){
  for(const id of Object.keys(fields))get(id).addEventListener('change',()=>void this.apply());
  get('post-natural').onclick=()=>void this.save({...NATURAL_POST,excludeAvatars:this.client.state?.studio.post?.excludeAvatars??true});
  get('post-reset').onclick=()=>void this.save({...DEFAULT_POST});
  const tabs=['render-tab','post-tab'];
  const select=(index:number)=>{tabs.forEach((id,i)=>{const button=get(id);button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;document.getElementById(button.getAttribute('aria-controls')!)!.hidden=i!==index;});};
  tabs.forEach((id,i)=>{get(id).onclick=()=>select(i);get(id).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:1-i;select(next);get(tabs[next]!).focus();}};});
 }
 update(state:AppSnapshot):void{
  if(this.busy)return;const p=state.studio.post??DEFAULT_POST;
  for(const [id,key]of Object.entries(fields)){const node=get(id);if(typeof p[key]==='boolean')node.checked=p[key] as boolean;else if(document.activeElement!==node)node.value=String(p[key]);}
 }
 private apply():Promise<void>{const p:Record<string,unknown>={};for(const [id,key]of Object.entries(fields)){const input=get(id);p[key]=typeof DEFAULT_POST[key]==='boolean'?input.checked:typeof DEFAULT_POST[key]==='number'?Number(input.value):input.value;}return this.save(p);}
 private async save(value:unknown):Promise<void>{
  if(this.busy||!this.client.state)return;this.busy=true;get('post-message').textContent='';
  const controls=[...document.querySelectorAll<HTMLInputElement>('#quality-controls input,#quality-controls select,#quality-controls button')];controls.forEach(c=>c.disabled=true);
  try{const state=this.client.state;await this.client.command({type:'studio-set',scene:{...state.studio,post:validatePost(value)}},state.revision);}
  catch(e){get('post-message').textContent=e instanceof Error?e.message:'ポストエフェクトを保存できません';}
  finally{this.busy=false;controls.forEach(c=>c.disabled=false);if(this.client.state)this.update(this.client.state);}
 }
}
