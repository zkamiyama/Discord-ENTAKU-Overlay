import type {NoteIntroductionSettings,NoteIntroductionState} from '../../contracts/note-introduction.ts';
import {validateNoteIntroductionSettings} from '../../note-introduction/settings.ts';
import type {StudioClient} from '../shared/client.ts';

const get=<T extends HTMLElement>(id:string)=>document.getElementById('note-introduction-'+id) as T;
const fileLimit=32*1024;
type Settings={generation:number;settings:NoteIntroductionSettings};
const labels:Record<NoteIntroductionState['status'],string>={disabled:'無効',idle:'URL待ち',loading:'取得中',showing:'紹介中',error:'取得できませんでした'};
const errors:Record<string,string>={
  SETTINGS_CONFLICT:'設定が別の操作で変更されました。現在の設定を読み直しました。確認してから、もう一度ファイルを読み込んでください。',
  SETTINGS_WRITE_FAILED:'設定を保存できませんでした。以前の設定を維持しています。',
  NOTE_INTRODUCTION_SETTINGS_INVALID:'設定JSONの enabled・instances・includeHome と形式のバージョンを確認してください。',
  NOTE_INTRODUCTION_FILE_INVALID:'JSONとして読み込めませんでした。ファイルの内容を確認してください。',
  NOTE_INTRODUCTION_FILE_TOO_LARGE:'設定JSONは32 KiB以下にしてください。',
  NOTE_INTRODUCTION_STATE_INVALID:'表示状態を確認できませんでした。接続を確認してください。',
  NOTE_INTRODUCTION_NOT_FOUND:'ノートが見つかりません。削除されている場合もあります。',
  NOTE_INTRODUCTION_NOT_PUBLIC:'設定で許可されている公開範囲のノートではありません。',
  NOTE_INTRODUCTION_SENSITIVE:'CW・センシティブ指定のノートは紹介しません。',
  NOTE_INTRODUCTION_INVALID_NOTE:'紹介できる形式のノートではありません。',
  NOTE_INTRODUCTION_EMPTY:'表示できる本文がありません。',
  NOTE_INTRODUCTION_TIMEOUT:'取得が時間切れになりました。',
  NOTE_INTRODUCTION_RATE_LIMITED:'インスタンスの取得制限に達しました。時間を置いてお試しください。',
  NOTE_INTRODUCTION_RESPONSE_TOO_LARGE:'ノートのデータ量が上限を超えています。',
  NOTE_INTRODUCTION_UNAVAILABLE:'インスタンスからノートを取得できませんでした。',
  NOTE_INTRODUCTION_REQUEST_FAILED:'操作を完了できませんでした。接続を確認してください。',
};
const changed='紹介対象が更新されました。現在の表示を確認してから、もう一度取り下げてください。';

export class NoteIntroductionPanel {
  private readonly file=get<HTMLInputElement>('file');
  private current:Settings|null=null;
  private state:NoteIntroductionState|null=null;
  private loading=false;private busy=false;private dismissing=false;
  private request=0;private dismissRequest=0;private stopped=false;
  private downloadUrl?:string;
  constructor(private readonly client:StudioClient){
    client.onNoteIntroduction=state=>{
      this.state=state;this.render();
      if(state&&!this.current)void this.load();
    };
    client.watchNoteIntroduction();
    get('import').onclick=()=>this.file.click();
    this.file.onchange=()=>{const file=this.file.files?.[0];this.file.value='';if(file)void this.import(file);};
    get('export').onclick=()=>void this.export();
    get('dismiss').onclick=()=>void this.dismiss();
    get<HTMLDetailsElement>('panel').addEventListener('toggle',()=>{if(!this.current)void this.load();});
    window.addEventListener('pagehide',()=>{this.stopped=true;this.request++;this.dismissRequest++;this.revokeDownload();},{once:true});
    this.renderSettings();this.render();
  }
  connectionChanged():void {
    if(!this.client.connected){
      this.request++;this.dismissRequest++;this.loading=false;this.busy=false;this.dismissing=false;this.current=null;this.renderSettings();
    }else if(!this.current)void this.load();
    this.controls();
  }
  reloadSettings():void {
    this.request++;this.loading=false;this.busy=false;this.current=null;this.renderSettings();this.controls();void this.load();
  }
  private active(request:number):boolean{return !this.stopped&&request===this.request;}
  private feedback(message:string,error=false):void {
    const output=get('feedback');output.textContent=message;output.dataset.error=String(error);
  }
  private report(error:unknown):void {
    const code=error instanceof Error?error.message:'';
    this.feedback(errors[code]??(/CONFLICT$/.test(code)?changed:code&&!/^[A-Z_0-9]+$/.test(code)?code:'操作を完了できませんでした。接続と設定を確認してください。'),true);
  }
  private controls():void {
    const ready=this.client.connected&&!!this.current&&!this.busy&&!this.loading;
    get<HTMLButtonElement>('import').disabled=!ready;this.file.disabled=!ready;
    get<HTMLButtonElement>('export').disabled=!ready;
    get<HTMLButtonElement>('dismiss').disabled=!this.client.connected||this.dismissing||!(this.state?.card||this.state?.pendingUrl);
    get('settings').setAttribute('aria-busy',String(this.loading||this.busy));
  }
  private renderSettings():void {
    const settings=this.current?.settings;
    get('enabled').textContent=settings?(settings.enabled?'有効':'無効'):'接続待ち';
    get('scope').textContent=settings?(settings.includeHome?'パブリック・ホーム':'パブリックのみ'):'—';
    const list=get('instances');list.replaceChildren();
    for(const instance of settings?.instances??[]){const item=document.createElement('li');item.textContent=instance;list.append(item);}
    get('instances-empty').hidden=!!settings?.instances.length;
    get('instances-empty').textContent=settings?'許可インスタンスが未設定です。':'設定を読み込みます。';
  }
  private render():void {
    const state=this.state,card=state?.card;
    get('badge').textContent=state?labels[state.status]:'接続待ち';
    const status=get('status');status.dataset.status=state?.status??'disconnected';
    const descriptions:Record<NoteIntroductionState['status'],string>={
      disabled:'自動紹介は設定ファイルで無効になっています。',idle:'VCチャットのノートURLを待っています。',
      loading:card?'次のノートを取得しています。':'ノートを取得しています。',showing:'映像に表示しています。',error:'ノートを取得できませんでした。',
    };
    status.textContent=state?(state.errorCode?errors[state.errorCode]??descriptions[state.status]:descriptions[state.status]):'ENTAKUとの接続待ちです。';
    if(state?.retryAt)status.textContent+=` ${new Date(state.retryAt).toLocaleTimeString('ja-JP')}以降にお試しください。`;
    get('current').hidden=!card;
    const link=get<HTMLAnchorElement>('link');
    link.textContent=card?`${card.authorName||card.username} @${card.username}`:'';
    if(card)link.href=card.url;else link.removeAttribute('href');
    get('body').textContent=card?.text??'';
    get('source').textContent=card?[new URL(card.instanceUrl).host,card.introducedBy?`${card.introducedBy} からの紹介`:'',card.attachmentCount?`添付 ${card.attachmentCount}件`:''].filter(Boolean).join(' · '):'';
    get('pending').hidden=!state?.pendingUrl;
    const pending=get<HTMLAnchorElement>('pending-link');pending.textContent=state?.pendingUrl??'';
    if(state?.pendingUrl)pending.href=state.pendingUrl;else pending.removeAttribute('href');
    this.controls();
  }
  private async load():Promise<void> {
    if(this.stopped||this.loading||this.busy||!this.client.connected)return;
    this.loading=true;const request=++this.request;this.controls();
    try{const value=await this.client.noteIntroductionSettings();if(this.active(request)){this.current=value;this.renderSettings();}}
    catch(error){if(this.active(request))this.report(error);}
    finally{if(this.active(request)){this.loading=false;this.controls();}}
  }
  private async import(file:File):Promise<void> {
    if(this.busy||this.loading||!this.current||!this.client.connected)return;
    const baseline=this.current,request=++this.request;this.busy=true;this.controls();
    this.feedback('設定JSONを読み込んでいます…');
    try{
      if(file.size>fileLimit)throw new Error('NOTE_INTRODUCTION_FILE_TOO_LARGE');
      let value:unknown;
      try{value=JSON.parse(await file.text());}catch{throw new Error('NOTE_INTRODUCTION_FILE_INVALID');}
      if(!this.active(request))return;
      const settings=validateNoteIntroductionSettings(value),latest=await this.client.noteIntroductionSettings();
      if(!this.active(request))return;
      // The generation also changes for unrelated stage edits. Rebase only
      // when this feature's settings still match what the operator saw.
      if(JSON.stringify(latest.settings)!==JSON.stringify(baseline.settings)){
        this.current=latest;this.renderSettings();throw new Error('SETTINGS_CONFLICT');
      }
      const saved=await this.client.setNoteIntroductionSettings(settings,latest.generation);
      if(!this.active(request))return;
      this.current=saved;this.renderSettings();
      this.feedback(saved.settings.enabled?'設定を読み込み、保存しました。':'設定を読み込み、自動紹介を無効にしました。');
    }catch(error){
      if(!this.active(request))return;
      if(error instanceof Error&&error.message==='SETTINGS_CONFLICT'){
        try{const latest=await this.client.noteIntroductionSettings();if(this.active(request)){this.current=latest;this.renderSettings();}}catch{/* Keep the original conflict visible. */}
      }
      if(this.active(request))this.report(error);
    }finally{if(this.active(request)){this.busy=false;this.controls();}}
  }
  private revokeDownload():void {if(this.downloadUrl){URL.revokeObjectURL(this.downloadUrl);this.downloadUrl=undefined;}}
  private async export():Promise<void> {
    if(this.busy||this.loading||!this.current||!this.client.connected)return;
    const request=++this.request;this.busy=true;this.controls();this.feedback('現在の設定を確認しています…');
    try{
      const current=await this.client.noteIntroductionSettings();if(!this.active(request))return;
      this.current=current;this.renderSettings();this.revokeDownload();
      const url=URL.createObjectURL(new Blob([JSON.stringify(current.settings,null,2)+'\n'],{type:'application/json;charset=utf-8'}));this.downloadUrl=url;
      const link=document.createElement('a');link.href=url;link.download='note-introduction.json';document.body.append(link);link.click();link.remove();
      setTimeout(()=>{if(this.downloadUrl===url)this.revokeDownload();},1000);
      this.feedback('設定JSONを書き出しました。');
    }catch(error){if(this.active(request))this.report(error);}
    finally{if(this.active(request)){this.busy=false;this.controls();}}
  }
  private async dismiss():Promise<void> {
    if(this.dismissing||!this.client.connected||!this.state||!(this.state.card||this.state.pendingUrl))return;
    const revision=this.state.revision,request=++this.dismissRequest;this.dismissing=true;this.controls();
    try{
      await this.client.dismissNoteIntroduction(revision);
      if(!this.stopped&&request===this.dismissRequest)this.feedback('紹介を取り下げました。次のノートURLから再開します。');
    }catch(error){if(!this.stopped&&request===this.dismissRequest)this.report(error);}
    finally{if(!this.stopped&&request===this.dismissRequest){this.dismissing=false;this.controls();}}
  }
}
