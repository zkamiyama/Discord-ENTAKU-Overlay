import {ENVIRONMENT_LIMITS,type EnvironmentInspection,type EnvironmentPackageSummary} from '../../environment/types.ts';
import type {Theme} from '../../presets/schema.ts';
import type {StudioClient} from '../shared/client.ts';
import {SETTINGS_ERROR_MESSAGES} from './settings-errors.ts';
const get=<T extends HTMLElement>(id:string)=>document.getElementById('environment-package-'+id) as T;
const errors:Record<string,string>={
 ...SETTINGS_ERROR_MESSAGES,
 SETTINGS_CONFLICT:'確認後に保存内容が変更されました。現在の設定を確認して、もう一度操作してください。',
 REVISION_CONFLICT:'確認後に設定が変更されました。ZIPを選び直し、内容を確認してから適用してください。',
 ENVIRONMENT_CONTEXT_CHANGED:'確認後に環境が変わりました。ZIPを選び直し、内容を確認してから適用してください。',
 ENVIRONMENT_INSPECTION_REQUIRED:'ZIPを選び直し、内容を確認してから適用してください。',
 ENVIRONMENT_ARCHIVE_TOO_LARGE:'ZIPと展開後の合計容量は、それぞれ512 MiB以下にしてください。',
 ENVIRONMENT_ARCHIVE_INVALID:'ENTAKUの環境パッケージとして読み込めないZIPです。書き出し元で作り直してください。',
 ENVIRONMENT_ARCHIVE_CORRUPT:'ZIPが破損しています。ファイルをコピーし直してください。',
 ENVIRONMENT_BLOB_CORRUPT:'素材ファイルが破損しています。書き出し元でパッケージを作り直してください。',
 ENVIRONMENT_MANIFEST_MISSING:'環境設定が含まれていません。ENTAKUから書き出したZIPを選んでください。',
 ENVIRONMENT_MANIFEST_INVALID:'環境設定を読み込めません。ENTAKUのバージョンと書き出し元の設定を確認してください。',
 ENVIRONMENT_PACKAGE_CHANGED:'確認時からファイルが変わりました。ZIPを選び直してください。',
 ENVIRONMENT_FILE_LIMIT:'パッケージに含まれる素材の数が上限を超えています。',
 ENVIRONMENT_FILE_TOO_LARGE:'1つの素材ファイルの容量が上限を超えています。',
 ENVIRONMENT_EXPANSION_LIMIT:'展開後の容量が上限を超えています。',
 ENVIRONMENT_ICON_UNAVAILABLE:'Discordの標準アイコンを取得できませんでした。接続を確認してから書き出してください。',
 ENVIRONMENT_HASH_MISMATCH:'ファイルの内容を確認できませんでした。ZIPをコピーし直してください。',
 ENVIRONMENT_SCHEMA_UNSUPPORTED:'このパッケージの形式に対応していません。ENTAKUのバージョンを確認してください。',
 ENVIRONMENT_DEPENDENCY_MISSING:'必要な素材が不足しています。書き出し元で素材を確認してください。',
 STUDIO_DEPENDENCY_MISSING:'スタジオのモデルやテクスチャが不足しています。',
 STUDIO_BUNDLE_NOT_FOUND:'スタジオ素材が見つかりません。',
 GAUSSIAN_ASSET_NOT_FOUND:'3DGS素材が見つかりません。',
 ASSET_NOT_FOUND:'人物画像が見つかりません。',
 AVATAR_UNAVAILABLE:'Discordの標準アイコンを取得できませんでした。接続を確認してから書き出してください。',
 IMAGE_TOO_LARGE:'画像の容量が上限を超えています。',
 IMAGE_DIMENSIONS_REJECTED:'画像の大きさが上限を超えています。',
 ASSET_STORE_FULL:'素材の保存容量が上限に達しています。',
};
type Operation='inspect'|'export'|'import';
const size=(bytes:number)=>{const unit=bytes>=1024*1024?'MiB':bytes>=1024?'KiB':'B',divisor=unit==='MiB'?1024*1024:unit==='KiB'?1024:1;return `${(bytes/divisor).toLocaleString('ja-JP',{maximumFractionDigits:1})} ${unit}`;};

export class EnvironmentPackagePanel {
 private readonly dialog=get<HTMLDialogElement>('dialog');
 private readonly input=get<HTMLInputElement>('file');
 private file:File|null=null;
 private inspection:EnvironmentInspection|null=null;
 private operation:Operation|null=null;
 private request=0;private stopped=false;
 private controller?:AbortController;
 private statusController?:AbortController;
 private downloadUrl?:string;
 constructor(private readonly client:StudioClient,private readonly onApplied:()=>void){
  get('open').onclick=()=>this.open();
  get('close').onclick=()=>this.dialog.close();
  get('export').onclick=()=>void this.export();
  get('apply').onclick=()=>void this.apply();
  this.input.onchange=()=>void this.inspect(this.input.files?.[0]??null);
  this.dialog.addEventListener('cancel',event=>{if(this.operation==='export'||this.operation==='import')event.preventDefault();});
  this.dialog.addEventListener('close',()=>{this.invalidate();this.clearSelection();get('open').focus();});
  window.addEventListener('pagehide',()=>{this.stopped=true;this.invalidate();this.revokeDownload();},{once:true});
  this.controls();
 }
 connectionChanged():void {
  this.controls();
  if(!this.client.connected)this.clearSelection();
  else if(this.dialog.open)void this.refreshStatus();
 }
 private open():void {
  if(this.dialog.open||this.stopped)return;
  this.feedback('');this.dialog.showModal();this.controls();void this.refreshStatus();
 }
 private async refreshStatus():Promise<void> {
  this.statusController?.abort();const controller=new AbortController();this.statusController=controller;
  try{
   const status=await this.client.environmentStatus(controller.signal);
   if(this.stopped||controller!==this.statusController||!this.dialog.open)return;
   this.preview(status.previewAvailable);
  }catch(error){
   if(this.stopped||controller!==this.statusController||controller.signal.aborted||!this.dialog.open)return;
   if(!this.operation&&!get('feedback').textContent)this.report(error,'環境情報を取得できませんでした。');
  }
 }
 private invalidate():void {
  this.request++;this.controller?.abort();this.controller=undefined;
  this.statusController?.abort();this.statusController=undefined;this.operation=null;this.controls();
 }
 private clearSelection():void {
  this.file=null;this.inspection=null;this.input.value='';get('review').hidden=true;
  get('filename').textContent='';get('summary').replaceChildren();this.controls();
 }
 private begin(operation:Operation):{request:number;controller:AbortController} {
  if(operation!=='inspect'){this.statusController?.abort();this.statusController=undefined;}
  this.controller?.abort();const controller=new AbortController();this.controller=controller;
  const request=++this.request;this.operation=operation;this.controls();return {request,controller};
 }
 private current(request:number,controller:AbortController):boolean {
  return !this.stopped&&this.dialog.open&&request===this.request&&controller===this.controller&&!controller.signal.aborted;
 }
 private finish(request:number,controller:AbortController):void {
  if(!this.current(request,controller))return;this.operation=null;this.controller=undefined;this.controls();
 }
 private controls():void {
  const committed=this.operation==='export'||this.operation==='import';
  get<HTMLButtonElement>('export').disabled=!!this.operation||!this.client.connected;
  get<HTMLButtonElement>('apply').disabled=!!this.operation||!this.inspection||!this.file||!this.client.connected;
  this.input.disabled=committed;get<HTMLButtonElement>('close').disabled=committed;
  this.dialog.setAttribute('aria-busy',String(!!this.operation));
 }
 private feedback(message:string,error=false):void {const element=get('feedback');element.textContent=message;element.dataset.error=String(error);}
 private report(error:unknown,action:string):void {
  const code=error instanceof Error?error.message:'ENVIRONMENT_REQUEST_FAILED';
  this.feedback(action+(errors[code]??(/^[A-Z][A-Z_]+$/.test(code)?`ファイルと保存先を確認してください。（${code}）`:code)),true);
 }
 private preview(available:boolean):void {get('preview').hidden=!available;}
 private summary(summary:EnvironmentPackageSummary):void {
  const date=new Date(summary.createdAt),counts=summary.counts;
  const rows:[string,string][]=[['作成したENTAKU',summary.appVersion],['作成日時',Number.isFinite(date.getTime())?date.toLocaleString('ja-JP'):summary.createdAt],['画面テーマ',{system:'端末の設定',light:'ライト',dark:'ダーク'}[summary.theme]],
   ['保存した出演者',`${counts.people}人`],['スタジオモデル',`${counts.studioBundles}件`],['人物画像・標準アイコン',`${counts.images}件`],
   ['3DGS素材',`${counts.gaussians}件`],['ZIP内のファイル',`${counts.files}件`],['ZIP / 展開後',`${size(summary.archiveBytes)} / ${size(summary.unpackedBytes)}`]];
  get('summary').replaceChildren(...rows.map(([label,value])=>{const row=document.createElement('div'),term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;row.append(term,detail);return row;}));
 }
 private async inspect(file:File|null):Promise<void> {
  if(this.operation==='export'||this.operation==='import')return;
  const {request,controller}=this.begin('inspect');this.file=file;this.inspection=null;get('review').hidden=true;get('summary').replaceChildren();
  if(!file){this.feedback('');this.finish(request,controller);return;}
  this.feedback('パッケージの内容と素材を確認しています…');
  try{
   if(file.size>ENVIRONMENT_LIMITS.archiveBytes)throw new Error('ENVIRONMENT_ARCHIVE_TOO_LARGE');
   const inspection=await this.client.inspectEnvironment(file,controller.signal);
   if(!this.current(request,controller)||this.file!==file)return;
   this.inspection=inspection;get('filename').textContent=file.name;this.summary(inspection.summary);get('review').hidden=false;
   this.feedback('内容を確認しました。「この環境を適用」で反映できます。');
  }catch(error){if(this.current(request,controller)){this.clearSelection();this.report(error,'読み込めませんでした。');}}
  finally{this.finish(request,controller);}
 }
 private revokeDownload():void {if(this.downloadUrl){URL.revokeObjectURL(this.downloadUrl);this.downloadUrl=undefined;}}
 private async export():Promise<void> {
  if(this.operation)return;const {request,controller}=this.begin('export');this.feedback('設定と必要な素材をまとめています…');
  try{
   const status=await this.client.environmentStatus(controller.signal);
   if(!this.current(request,controller)||!this.client.state)return;
   this.preview(status.previewAvailable);
   const blob=await this.client.exportEnvironment({theme:(document.getElementById('theme') as HTMLSelectElement).value as Theme,
    expectedRevision:this.client.state.revision,expectedGeneration:status.generation},controller.signal);
   if(!this.current(request,controller))return;
   this.revokeDownload();const url=URL.createObjectURL(blob);this.downloadUrl=url;
   const link=document.createElement('a');link.href=url;link.download='entaku-environment.entaku.zip';document.body.append(link);link.click();link.remove();
   setTimeout(()=>{if(this.downloadUrl===url)this.revokeDownload();},1000);
   this.feedback(`環境パッケージを書き出しました。（${size(blob.size)}）`);
  }catch(error){if(this.current(request,controller))this.report(error,'書き出せませんでした。');}
  finally{this.finish(request,controller);}
 }
 private async apply():Promise<void> {
  if(this.operation||!this.file||!this.inspection)return;
  const file=this.file,inspection=this.inspection,{request,controller}=this.begin('import');this.feedback('素材を読み込み、環境を適用しています…');
  try{
   const result=await this.client.importEnvironment(file,{sha256:inspection.summary.sha256,expectedRevision:inspection.revision,expectedGeneration:inspection.generation},controller.signal);
   if(!this.current(request,controller)||this.file!==file||this.inspection!==inspection)return;
   const theme=document.getElementById('theme') as HTMLSelectElement;theme.value=result.theme;theme.dispatchEvent(new Event('change'));
   this.onApplied();this.clearSelection();this.preview(result.previewAvailable);
   this.feedback(result.previewAvailable?'環境を適用しました。保存時の出演者はプレビューで確認できます。':'環境を適用しました。');
  }catch(error){if(this.current(request,controller)){this.clearSelection();this.report(error,'適用できませんでした。');}}
  finally{this.finish(request,controller);}
 }
}
