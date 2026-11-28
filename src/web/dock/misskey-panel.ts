import type {MisskeySettings,MisskeyState,MisskeyRejectReason} from '../../contracts/misskey.ts';
import {StudioClient} from '../shared/client.ts';
const get=<T extends HTMLElement>(id:string)=>document.getElementById('misskey-'+id) as T;
const labels:Record<string,string>={disabled:'停止中',connecting:'購読を接続中',live:'受信中',reconnecting:'再接続を待機中',error:'接続を確認してください'};
const reasons:Record<MisskeyRejectReason,string>={'invalid':'不正なデータ','not-public':'公開範囲','remote':'別インスタンス','wrong-tag':'対象外タグ','sensitive':'CW・センシティブ','empty':'本文なし','blocked-word':'除外語句','blocked-user':'除外投稿者','repetition':'反復','duplicate':'重複','user-limit':'投稿者の上限','queue-full':'待機上限','too-old':'期限外','rate-limit':'短時間の大量投稿'};
const errors:Record<string,string>={SETTINGS_CONFLICT:'設定が別の操作で更新されました。現在の値を読み直しました。変更を確認してもう一度保存してください。',MISSKEY_SETTINGS_INVALID:'接続先・タグ・表示上限・除外リストを確認してください。',SETTINGS_WRITE_FAILED:'設定を保存できませんでした。以前の設定を維持しています。'};
export class MisskeyPanel {
 private current:{generation:number;settings:MisskeySettings}|null=null;
 private loading=false;private busy=false;private request=0;private stopped=false;
 private lastState:MisskeyState|null=null;
 constructor(private client:StudioClient){
  client.onMisskey=state=>{this.lastState=state;this.render(state);if(state&&!this.current)void this.load();};
  client.watchMisskey();
  get<HTMLFormElement>('form').onsubmit=e=>{e.preventDefault();void this.save();};
  get<HTMLButtonElement>('clear').onclick=()=>void this.control('clear');
  get<HTMLButtonElement>('pause').onclick=()=>void this.control('pause',!this.lastState?.paused);
  get<HTMLDetailsElement>('panel').addEventListener('toggle',()=>{if(!this.current&&!this.loading)void this.load();});
  window.addEventListener('pagehide',()=>{this.stopped=true;this.request++;},{once:true});
 }
 private fill(settings:MisskeySettings):void{
  get<HTMLInputElement>('enabled').checked=settings.enabled;get<HTMLInputElement>('instance').value=settings.instanceUrl;
  get<HTMLInputElement>('tag').value=settings.hashtag;get<HTMLInputElement>('local').checked=settings.localOnly;get<HTMLInputElement>('home').checked=settings.includeHome;
  get<HTMLInputElement>('max').value=String(settings.maxCards);get<HTMLInputElement>('per-user').value=String(settings.maxPerUser);
  get<HTMLInputElement>('lifetime').value=String(settings.lifetimeMs/1000);get<HTMLInputElement>('characters').value=String(settings.maxCharacters);
  get<HTMLTextAreaElement>('words').value=settings.blockedWords.join('\n');get<HTMLTextAreaElement>('users').value=settings.blockedUsers.join('\n');
 }
 private read():MisskeySettings{
  const lines=(id:string)=>get<HTMLTextAreaElement>(id).value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  return {enabled:get<HTMLInputElement>('enabled').checked,instanceUrl:get<HTMLInputElement>('instance').value,hashtag:get<HTMLInputElement>('tag').value,
   localOnly:get<HTMLInputElement>('local').checked,includeHome:get<HTMLInputElement>('home').checked,maxCards:get<HTMLInputElement>('max').valueAsNumber,maxPerUser:get<HTMLInputElement>('per-user').valueAsNumber,
   lifetimeMs:get<HTMLInputElement>('lifetime').valueAsNumber*1000,maxCharacters:get<HTMLInputElement>('characters').valueAsNumber,blockedWords:lines('words'),blockedUsers:lines('users')};
 }
 private async load():Promise<void>{
  if(this.loading||this.stopped)return;this.loading=true;const request=++this.request;
  try{const value=await this.client.misskeySettings();if(this.stopped||request!==this.request)return;this.current=value;this.fill(value.settings);}
  catch(error){if(!this.stopped)this.feedback(error);}
  finally{this.loading=false;get<HTMLButtonElement>('save').disabled=!this.current||this.busy;}
 }
 private feedback(error:unknown):void{const code=error instanceof Error?error.message:String(error);get('feedback').textContent=errors[code]??code;get('feedback').dataset.error='true';}
 private async save():Promise<void>{
  if(!this.current||this.busy)return;this.busy=true;get<HTMLButtonElement>('save').disabled=true;
  try{const next=await this.client.setMisskeySettings(this.read(),this.current.generation);this.current=next;this.fill(next.settings);get('feedback').textContent=next.settings.enabled?'保存しました。接続状況は上に表示します。':'保存しました。受信と表示を停止しました。';get('feedback').dataset.error='false';}
  catch(error){if(error instanceof Error&&error.message==='SETTINGS_CONFLICT')await this.load();this.feedback(error);}
  finally{this.busy=false;get<HTMLButtonElement>('save').disabled=!this.current;}
 }
 private async control(action:'clear'|'pause',paused?:boolean):Promise<void>{
  if(this.busy)return;
  try{await this.client.controlMisskey(action,paused);get('feedback').textContent=action==='clear'?'表示と待機中のノートを消去しました。':paused?'表示を一時停止しました。':'表示を再開しました。';get('feedback').dataset.error='false';}
  catch(error){this.feedback(error);}
 }
 private async blockUser(userId:string):Promise<void>{
  if(this.busy)return;this.busy=true;get<HTMLButtonElement>('save').disabled=true;
  try{
   const current=await this.client.misskeySettings();
   const next=await this.client.setMisskeySettings({...current.settings,blockedUsers:[...new Set([...current.settings.blockedUsers,userId])]},current.generation);
   this.current=next;
   const draft=get<HTMLTextAreaElement>('users');draft.value=[...new Set([...draft.value.split(/\r?\n/).filter(Boolean),...next.settings.blockedUsers])].join('\n');
   get('feedback').textContent='この投稿者を除外しました。表示中・待機中のノートを消去し、以後の投稿も除外します。';get('feedback').dataset.error='false';
  }catch(error){this.feedback(error);}
  finally{this.busy=false;get<HTMLButtonElement>('save').disabled=!this.current;}
 }
 private render(state:MisskeyState|null):void{
  const status=state?.paused?'表示を一時停止中':state?labels[state.status]:'ENTAKUに接続中';
  get('badge').textContent=status??'';get('status').dataset.status=state?.status??'disconnected';
  const retry=state?.retryAt?` · 次回 ${new Date(state.retryAt).toLocaleTimeString('ja-JP')}`:'';
  get('status').textContent=state?`${status} · ${new URL(state.instanceUrl).host} / #${state.hashtag}${retry}${state.errorCode?' · '+state.errorCode:''}`:status??'';
  get<HTMLButtonElement>('pause').textContent=state?.paused?'表示を再開':'表示を一時停止';
  get<HTMLButtonElement>('pause').disabled=!state||state.status==='disabled';get<HTMLButtonElement>('clear').disabled=!state;
  get('stats').textContent=state?`表示 ${state.cards.length}件 · 待機 ${state.queued}件 · 受信 ${state.received}件 · 採用 ${state.accepted}件`:'表示 0件';
  const list=get('notes');list.replaceChildren();
  for(const card of state?.cards??[]){
   const item=document.createElement('article');item.className='misskey-note';item.dataset.noteId=card.id;
   const author=document.createElement('a');author.href=card.url;author.target='_blank';author.rel='noopener noreferrer';author.textContent=card.authorName+' @'+card.username;
   const body=document.createElement('p');body.textContent=card.text;
   const id=document.createElement('small');id.textContent='投稿者ID: '+card.userId;
   const block=document.createElement('button');block.type='button';block.className='misskey-block';block.textContent='この投稿者を除外';block.onclick=()=>void this.blockUser(card.userId);
   item.append(author,body,id,block);list.append(item);
  }
  const rejected=state?Object.entries(state.rejected).filter(([,n])=>n).map(([k,n])=>`${reasons[k as MisskeyRejectReason]} ${n}件`).join(' / '):'';
  get('rejections').textContent=(rejected?`除外: ${rejected}`:'除外されたノートはありません。')+(state?.recoveryTruncated?' · 補完できていないノートがある可能性があります。':'');
 }
}
