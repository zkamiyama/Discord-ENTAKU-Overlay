import type {VcChatMessage,VcChatState} from '../../contracts/vc-chat.ts';
import type {StudioClient} from '../shared/client.ts';
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const labels:Record<VcChatState['status'],string>={unavailable:'ライブ接続時に表示します',connecting:'Discordへ接続中',disconnected:'切断・再接続待ち', 'no-channel':'サーバーVCに参加してください',unsupported:'サーバーVCのみ対応しています',subscribing:'チャットを購読中',live:'受信中',error:'チャットを取得できません'};
/** Text nodes and opt-in links only: no remote previews, Markdown HTML or scripts. */
function body(content:string):DocumentFragment {
  const fragment=document.createDocumentFragment();let last=0;
  for(const match of content.matchAll(/https?:\/\/[^\s<>"\u0000-\u001f]+/g)){
    const index=match.index!;fragment.append(document.createTextNode(content.slice(last,index)));const url=match[0];
    const link=document.createElement('a');link.textContent=url;link.href=url;link.target='_blank';link.rel='noopener noreferrer';fragment.append(link);last=index+url.length;
  }
  fragment.append(document.createTextNode(content.slice(last)));return fragment;
}
function item(message:VcChatMessage):HTMLElement {
  const row=document.createElement('article');row.className='chat-message';row.dataset.messageId=message.id;
  const header=document.createElement('header'),name=document.createElement('span'),time=document.createElement('time');
  name.className='chat-author';name.textContent=message.authorName;
  time.className='chat-time';time.dateTime=message.timestamp;time.title=new Date(message.timestamp).toLocaleString('ja-JP');time.textContent=new Date(message.timestamp).toLocaleTimeString('ja-JP',{hour12:false});
  header.append(name,time);row.append(header);
  const content=document.createElement('p');content.className='chat-body';content.append(body(message.content));row.append(content);
  const extra=[message.editedTimestamp?'編集済み':'',message.attachmentCount?`添付 ${message.attachmentCount}件（ファイルはDiscordで確認）`:'',message.truncated?'長文のため先頭4000文字を表示':''].filter(Boolean).join(' · ');
  if(extra){const note=document.createElement('p');note.className='chat-extra';note.textContent=extra;row.append(note);}return row;
}
export class VcChatPanel {
  private list=get('vc-chat-messages');private latest=get<HTMLButtonElement>('vc-chat-latest');
  private state:VcChatState|null=null;private rows=new Map<string,{key:string;element:HTMLElement}>();
  constructor(client:StudioClient){
    client.onChat=state=>this.update(state);client.watchChat();
    this.latest.onclick=()=>this.bottom();
    this.list.addEventListener('scroll',()=>{if(this.atBottom())this.latest.hidden=true;});
    get('vc-chat-copy').onclick=()=>void this.copy();
  }
  private atBottom(){return this.list.scrollHeight-this.list.scrollTop-this.list.clientHeight<24;}
  private bottom(){this.list.scrollTop=this.list.scrollHeight;this.latest.hidden=true;}
  private async copy(){
    const messages=this.state?.messages??[];
    const value=messages.map(m=>`[${new Date(m.timestamp).toLocaleTimeString('ja-JP',{hour12:false})}] ${m.authorName}: ${m.content}`).join('\n');
    try{await navigator.clipboard.writeText(value);get('vc-chat-feedback').textContent='表示中の本文をコピーしました';}
    catch{get('vc-chat-feedback').textContent='コピーできませんでした。本文を選択してコピーしてください。';}
  }
  private update(state:VcChatState|null):void {
    const changedChannel=state?.channelId!==this.state?.channelId,follow=changedChannel||this.atBottom();this.state=state;
    const status=get('vc-chat-status');status.dataset.status=state?.status??'disconnected';
    const limited=state?.status==='live'&&(state.updates===false||state.deletions===false)?'（編集・削除の追従は一部利用不可）':'';
    status.textContent=state?`${state.channelName?state.channelName+' · ':''}${labels[state.status]}${limited}${state.errorCode?' · '+state.errorCode:''}${state.rpcCode!==null?' / RPC '+state.rpcCode:''}`:'サーバーとの接続待ち';
    const messages=state?.messages??[],ids=new Set(messages.map(m=>m.id));let added=false;
    for(const [id,row] of this.rows)if(!ids.has(id)){row.element.remove();this.rows.delete(id);}
    for(let i=0;i<messages.length;i++){
      const message=messages[i]!,key=JSON.stringify(message),current=this.rows.get(message.id);
      if(current?.key!==key){const element=item(message);if(current)current.element.replaceWith(element);else{this.list.append(element);added=true;}this.rows.set(message.id,{key,element});}
      const element=this.rows.get(message.id)!.element,at=this.list.children[i];if(at!==element)this.list.insertBefore(element,at??null);
    }
    get('vc-chat-count').textContent=`${messages.length}件`;get<HTMLButtonElement>('vc-chat-copy').disabled=!messages.length;
    get('vc-chat-empty').hidden=messages.length>0;get('vc-chat-empty').textContent=state?.status==='live'?'投稿待ちです。':'参加中VCの投稿をここに表示します。';
    if(changedChannel||!messages.length)get('vc-chat-feedback').textContent='';
    if(follow)this.bottom();else if(added)this.latest.hidden=false;
  }
}
