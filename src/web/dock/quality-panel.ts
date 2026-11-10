import {SettingForm} from './setting-form.ts';
import {numericEditing} from './numeric-controls.ts';
import {DEFAULT_QUALITY,validateQuality,type QualitySettings} from '../../studio/quality.ts';
import {DEFAULT_GAUSSIAN_SETTINGS,validateGaussianSettings} from '../../assets/gaussian-profile.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioClient} from '../shared/client.ts';
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const fields:Record<string,keyof QualitySettings>={'quality-shadows':'shadows','quality-shadow-size':'shadowSize','quality-shadow-lights':'shadowLights','quality-ao-strength':'aoStrength','quality-ao-radius':'aoRadius','quality-reflection-strength':'reflectionOpacity','quality-scale':'effectsScale','quality-nameplates':'nameplates','quality-msaa':'msaa','quality-render-scale':'renderScale','quality-gi-strength':'giStrength','quality-gi-radius':'giRadius'};
export class QualityPanel {
 private form:SettingForm<'quality'>;
 private gaussianForm:SettingForm<'gaussian'>;
 private get busy(){return this.form.busy;}
 constructor(private client:StudioClient){
  this.form=new SettingForm(client,'quality',validateQuality,'#quality-controls input,#quality-controls select,#quality-controls button,#table-settings select','quality-message',s=>this.update(s));
  this.gaussianForm=new SettingForm(client,'gaussian',validateGaussianSettings,'#gaussian-budget','quality-message',s=>this.update(s));
  input('gaussian-budget').addEventListener('change',()=>void this.gaussianForm.save({lodSplatCount:Number(input('gaussian-budget').value)}));
  for(const id of [...Object.keys(fields),'quality-ao','quality-reflections','quality-fxaa','quality-gi'])input(id).addEventListener('change',()=>void this.apply());
  input('quality-default').onclick=()=>void this.preset({});
  input('quality-low').onclick=()=>void this.preset({shadows:'off',msaa:0,ao:'off',reflections:false,fxaa:false,gi:'off'});
  input('quality-high').onclick=()=>void this.preset({shadows:'soft',shadowSize:2048,ao:'gtao',reflections:true,fxaa:false,msaa:4,renderScale:1.5});
 }
 update(state:AppSnapshot):void{
  if(this.busy)return;const q=state.studio.quality??DEFAULT_QUALITY;
  if(!this.gaussianForm.busy&&!numericEditing(input('gaussian-budget')))input('gaussian-budget').value=String((state.studio.gaussian??DEFAULT_GAUSSIAN_SETTINGS).lodSplatCount);
  for(const [id,key]of Object.entries(fields))if(!numericEditing(input(id)))input(id).value=String(q[key]);
  input('quality-ao').checked=q.ao==='gtao';input('quality-reflections').checked=q.reflections;input('quality-fxaa').checked=q.fxaa;input('quality-gi').checked=q.gi==='ssgi';
 }
 private preset(value:Partial<QualitySettings>):Promise<void>{return this.save({...DEFAULT_QUALITY,nameplates:this.client.state?.studio.quality?.nameplates??DEFAULT_QUALITY.nameplates,...value});}
 private apply():Promise<void>{
  const q:Record<string,unknown>={...DEFAULT_QUALITY};
  for(const [id,key]of Object.entries(fields))q[key]=typeof DEFAULT_QUALITY[key]==='number'?Number(input(id).value):input(id).value;
  q.ao=input('quality-ao').checked?'gtao':'off';q.reflections=input('quality-reflections').checked;q.fxaa=input('quality-fxaa').checked;q.gi=input('quality-gi').checked?'ssgi':'off';
  return this.save(q);
 }
 private save(value:unknown):Promise<void>{return this.form.save(value);}
}
