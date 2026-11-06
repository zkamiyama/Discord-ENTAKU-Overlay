import type { RuntimeDiagnostics } from '../../contracts/diagnostics.ts';
import type { StudioClient } from '../shared/client.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export class DiagnosticsPanel {
  private current:RuntimeDiagnostics|null=null;private busy=false;
  constructor(private client:StudioClient){
    $('diagnostics-refresh').onclick=()=>void this.refresh();
    $('diagnostics-export').onclick=()=>void this.download('/api/diagnostics','entaku-diagnostics.json');
    $('record-start').onclick=()=>{if(confirm('名前・Discord IDを仮名化した発話イベントをメモリに記録します。音声は録音しません。開始しますか？'))void this.command({type:'record-start'});};
    $('record-stop').onclick=()=>void this.command({type:'record-stop'});
    $('record-export').onclick=()=>void this.download('/api/replay/export','entaku-events.jsonl');
    $('replay-play').onclick=()=>void this.command({type:'replay-control',action:this.current?.replay?.paused?'play':'pause'});
    $<HTMLSelectElement>('replay-rate').onchange=()=>void this.command({type:'replay-control',action:'rate',value:Number($<HTMLSelectElement>('replay-rate').value)});
    $<HTMLInputElement>('replay-seek').onchange=()=>void this.command({type:'replay-control',action:'seek',value:Number($<HTMLInputElement>('replay-seek').value)});
    const poll=async()=>{if(!document.hidden&&this.client.connected)await this.refresh();setTimeout(()=>void poll(),1500);};void poll();
  }
  private async command(value:Record<string,unknown>):Promise<void>{
    if(this.busy)return;this.busy=true;
    try{await this.client.command(value);await this.refresh();}catch(e){$('diagnostics-message').textContent=e instanceof Error?e.message:'操作に失敗しました';}finally{this.busy=false;}
  }
  private async download(path:string,name:string):Promise<void>{
    try{const response=await this.client.localFetch(path),url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(e){$('diagnostics-message').textContent=e instanceof Error?e.message:'書き出しに失敗しました';}
  }
  private async refresh():Promise<void>{
    if(!this.client.connected)return;
    try{
      const d:RuntimeDiagnostics=await (await this.client.localFetch('/api/diagnostics')).json();this.current=d;
      $('renderer-status').textContent=d.render?`${d.render.status} · フレーム間隔 ${d.render.frameMs.toFixed(1)}ms · ${d.render.drawCalls} draws · ${d.render.triangles.toLocaleString()} triangles`:'映像ページの接続待ち';
      $('recording-status').textContent=`${d.recording.active?'記録中':'停止'} · ${d.recording.eventCount}イベント${d.recording.limitReached?' · 記録上限に達しました':''}`;
      $<HTMLButtonElement>('record-start').disabled=d.source==='replay'||d.recording.active;$<HTMLButtonElement>('record-stop').disabled=!d.recording.active;
      $<HTMLButtonElement>('record-export').disabled=d.recording.eventCount===0;
      $('replay-controls').hidden=!d.replay;
      if(d.replay){const r=d.replay;const seek=$<HTMLInputElement>('replay-seek');seek.max=String(r.durationMs);if(document.activeElement!==seek)seek.value=String(r.elapsedMs);seek.disabled=r.seeking;
        $('replay-time').textContent=`${(r.elapsedMs/1000).toFixed(1)} / ${(r.durationMs/1000).toFixed(1)}秒${r.seeking?' · 移動中':''}`;$('replay-play').textContent=r.paused?'再生':'一時停止';$<HTMLSelectElement>('replay-rate').value=String(r.rate);}
      $('diagnostic-events').textContent=d.events.slice(-40).reverse().map(e=>`${(e.atMs/1000).toFixed(2)}s ${e.kind}: ${e.code}${e.count===undefined?'':' ('+e.count+')'}`).join('\n');
    }catch(e){$('diagnostics-message').textContent=e instanceof Error?e.message:'診断を取得できません';}
  }
}
