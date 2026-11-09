import {DiagnosticsFeed} from './diagnostics-feed.ts';
import {SettingForm} from './setting-form.ts';
import {numericEditing} from './numeric-controls.ts';
import {DEFAULT_EXPOSURE,validateExposure,type ExposureSettings} from '../../studio/exposure.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {StudioClient} from '../shared/client.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export class ExposurePanel {
  private form:SettingForm<'exposure'>;
 private get busy(){return this.form.busy;}
  constructor(private readonly client:StudioClient){
    this.form=new SettingForm(client,'exposure',validateExposure,'#exposure-controls input,#exposure-controls button,#exposure-controls select','exposure-message',s=>this.update(s));
    for(const id of ['exposure-auto','exposure-ev','exposure-manual','exposure-lighting'])$(id).addEventListener('change',()=>void this.apply());
    $('exposure-reset').onclick=()=>void this.save({...DEFAULT_EXPOSURE});
    $('exposure-lock').onclick=()=>void this.lock();
    DiagnosticsFeed.for(client).subscribe(d=>{
      const r=d.render;
      if(r?.exposure!==undefined){
        const status:Record<string,string>={AUTO:'自動',MANUAL:'固定',EMPTY_METER:'測光対象なし',HDR_UNAVAILABLE:'HDR非対応：手動値を使用',METER_FAILED:'測光失敗：手動値を使用'};
        $('exposure-current').textContent=`${status[r.exposureStatus??'']??'測光中'} · ×${r.exposure.toPrecision(4)} · 素材 ${r.authoredLights??0}灯${r.fallbackLights?'＋標準照明':''}`;
      }else $('exposure-current').textContent='映像ページの測光待ち';
    });
  }
  update(state:AppSnapshot):void{
    if(this.busy)return;const e=state.studio.exposure??DEFAULT_EXPOSURE;
    const values:Record<string,string>={'exposure-ev':String(e.compensationEV),'exposure-manual':String(e.manualExposure),'exposure-lighting':e.lighting};
    for(const [id,value]of Object.entries(values)){const input=$<HTMLInputElement>(id);if(!numericEditing(input))input.value=value;}
    $<HTMLInputElement>('exposure-auto').checked=e.mode==='auto';
    $<HTMLInputElement>('exposure-manual').disabled=e.mode==='auto';
  }
  private async apply():Promise<void>{
    await this.save({mode:$<HTMLInputElement>('exposure-auto').checked?'auto':'manual',compensationEV:Number($<HTMLInputElement>('exposure-ev').value),manualExposure:Number($<HTMLInputElement>('exposure-manual').value),lighting:$<HTMLSelectElement>('exposure-lighting').value as ExposureSettings['lighting']});
  }
  private save(value:unknown):Promise<void>{return this.form.save(value);}
  private async lock():Promise<void>{
    if(this.busy||!this.client.state)return;
    try{
      const d=await DiagnosticsFeed.for(this.client).refresh(),value=d.render?.exposure;
      if(value===undefined)throw new Error('映像ページを開いてから固定してください');
      const e=this.client.state.studio.exposure??DEFAULT_EXPOSURE;
      await this.save({...e,mode:'manual',compensationEV:0,manualExposure:value});
    }catch(e){$('exposure-message').textContent=e instanceof Error?e.message:'測光値を取得できません';}
  }
}
