import {BLENDER_REFERENCE_EXPOSURE,DEFAULT_EXPOSURE,validateExposure,type ExposureSettings} from '../../studio/exposure.ts';
import type {AppSnapshot} from '../../contracts/domain.ts';
import type {RuntimeDiagnostics} from '../../contracts/diagnostics.ts';
import type {StudioClient} from '../shared/client.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export class ExposurePanel {
  private busy=false;
  constructor(private readonly client:StudioClient){
    for(const id of ['exposure-auto','exposure-ev','exposure-manual','exposure-lighting'])$(id).addEventListener('change',()=>void this.apply());
    $('exposure-reference').onclick=()=>void this.save({mode:'manual',manualExposure:BLENDER_REFERENCE_EXPOSURE,compensationEV:0,lighting:'studio'});
    $('exposure-reset').onclick=()=>void this.save({...DEFAULT_EXPOSURE});
    $('exposure-lock').onclick=()=>void this.lock();
    const poll=async()=>{if(client.connected&&!document.hidden){try{
      const d:RuntimeDiagnostics=await(await client.localFetch('/api/diagnostics')).json(),r=d.render;
      if(r?.exposure!==undefined){
        const status:Record<string,string>={AUTO:'自動',MANUAL:'固定',EMPTY_METER:'測光対象なし',HDR_UNAVAILABLE:'HDR非対応：手動値を使用',METER_FAILED:'測光失敗：手動値を使用'};
        $('exposure-current').textContent=`${status[r.exposureStatus??'']??'測光中'} · ×${r.exposure.toPrecision(4)} · 素材 ${r.authoredLights??0}灯${r.fallbackLights?'＋標準照明':''}`;
      }else $('exposure-current').textContent='映像ページの測光待ち';
    }catch{ $('exposure-current').textContent='測光情報を取得できません'; }}setTimeout(()=>void poll(),1000);};void poll();
  }
  update(state:AppSnapshot):void{
    if(this.busy)return;const e=state.studio.exposure??DEFAULT_EXPOSURE;
    const values:Record<string,string>={'exposure-ev':String(e.compensationEV),'exposure-manual':String(e.manualExposure),'exposure-lighting':e.lighting};
    for(const [id,value]of Object.entries(values)){const input=$<HTMLInputElement>(id);if(document.activeElement!==input)input.value=value;}
    $<HTMLInputElement>('exposure-auto').checked=e.mode==='auto';
    $<HTMLInputElement>('exposure-manual').disabled=e.mode==='auto';
  }
  private async apply():Promise<void>{
    await this.save({mode:$<HTMLInputElement>('exposure-auto').checked?'auto':'manual',compensationEV:Number($<HTMLInputElement>('exposure-ev').value),manualExposure:Number($<HTMLInputElement>('exposure-manual').value),lighting:$<HTMLSelectElement>('exposure-lighting').value as ExposureSettings['lighting']});
  }
  private async save(value:ExposureSettings):Promise<void>{
    if(this.busy||!this.client.state)return;this.busy=true;$('exposure-message').textContent='';
    for(const e of $('exposure-controls').querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select'))e.disabled=true;
    try{const state=this.client.state;await this.client.command({type:'studio-set',scene:{...state.studio,exposure:validateExposure(value)}},state.revision);}
    catch(e){$('exposure-message').textContent=e instanceof Error?e.message:'露出を保存できません';}
    finally{this.busy=false;for(const e of $('exposure-controls').querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select'))e.disabled=false;if(this.client.state)this.update(this.client.state);}
  }
  private async lock():Promise<void>{
    if(this.busy||!this.client.state)return;
    try{
      const d:RuntimeDiagnostics=await(await this.client.localFetch('/api/diagnostics')).json(),value=d.render?.exposure;
      if(value===undefined)throw new Error('映像ページを開いてから固定してください');
      const e=this.client.state.studio.exposure??DEFAULT_EXPOSURE;
      await this.save({...e,mode:'manual',compensationEV:0,manualExposure:value});
    }catch(e){$('exposure-message').textContent=e instanceof Error?e.message:'測光値を取得できません';}
  }
}
