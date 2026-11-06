import { DiagnosticsPanel } from './diagnostics-panel.ts';
import { StudioEditor } from './studio-editor.ts';
import { AvatarEditor } from './avatar-editor.ts';
import { StudioClient } from '../shared/client.ts';
import { dockPeople, type DockPerson } from './people.ts';
const client=new StudioClient();
const editor=new AvatarEditor(client);
new StudioEditor(client);
new DiagnosticsPanel(client);
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const errors=get('error');let busy=false;
async function command(value:Record<string,unknown>){if(busy)return;busy=true;errors.textContent='';try{await client.command(value);}catch(e){errors.textContent=e instanceof Error?e.message:'操作に失敗しました';}finally{busy=false;}}
get('auto').onclick=()=>void command({type:'mode',mode:'AUTO'});
get('hold').onclick=()=>void command({type:'mode',mode:'HOLD'});
get('wide').onclick=()=>void command({type:'wide'});
get('retry').onclick=()=>{if(confirm('Discordの認可画面が表示される場合があります。再接続しますか？'))void command({type:'retry'});};
get('new-session').onclick=()=>{if(confirm('退出者の席予約を消し、現在の参加者で配置し直しますか？'))void command({type:'new-session',confirm:true});};
get('add').onclick=()=>void command({type:'demo-add'});
get('copy').onclick=()=>{const text=get<HTMLInputElement>('overlay-url').value;void navigator.clipboard.writeText(text).catch(()=>{get<HTMLInputElement>('overlay-url').select();errors.textContent='URL欄を選択しました。コピーしてください。';});};
client.onConnection=status=>{get('transport').textContent=status;};
interface Row { element:HTMLElement; name:HTMLElement; status:HTMLElement; focus:HTMLButtonElement; speak:HTMLButtonElement; presence:HTMLButtonElement; release:HTMLButtonElement; edit:HTMLButtonElement; user:DockPerson }
const rows=new Map<string,Row>();
function row(user:DockPerson):Row {
 const element=document.createElement('div');element.className='person';
 const heading=document.createElement('div');heading.className='person-header';const name=document.createElement('span');name.className='person-name';const status=document.createElement('span');status.className='person-state';heading.append(name,status);
 const buttons=document.createElement('div');buttons.className='person-buttons';
 const button=(text:string)=>{const b=document.createElement('button');b.textContent=text;buttons.append(b);return b;};
 const focus=button('この人を撮る'),speak=button('発話 ON'),presence=button('退出'),release=button('予約を解放'),edit=button('画像を調整');element.append(heading,buttons);
 const result={element,name,status,focus,speak,presence,release,edit,user};
 focus.onclick=()=>void command({type:'single',userId:user.userId});
 speak.onclick=()=>void command({type:'demo-speaking',userId:user.userId,active:result.user.speaking!=='active'});
 presence.onclick=()=>void command({type:'demo-presence',userId:user.userId,present:result.user.presence!=='present'});
 release.onclick=()=>{if(confirm(`${result.user.name}の席予約を解放しますか？`))void command({type:'release',userId:user.userId,confirm:true});};
 edit.onclick=()=>void editor.open(result.user.userId,result.user.name);
 get('participants').append(element);return result;
}
client.onState=state=>{
 get('studio-current').textContent=`シーン ${state.studio.revision} · ${state.studio.objects.length}オブジェクト`;

 get('mode').textContent=state.mode;get('shot').textContent=state.camera.shot.kind;get('camera-transition').textContent=state.camera.transition;get('reason').textContent=state.camera.safetyReason??state.decision.reason;get('remaining').textContent=`${(state.decision.holdRemainingMs/1000).toFixed(1)} 秒`;
 const count=state.participants.filter(p=>p.presence==='present').length;
 get('counts').textContent=`${count}人 / ${state.session.capacity}席`;
 get('connection').textContent=`${state.connection} · ${state.channel?.name??'VC未選択'}${state.errorCode?' · '+state.errorCode:''}`;
 get('source').textContent=state.source==='demo'?'デモ入力です。発話ボタンでカメラ切替を試せます。':state.source==='replay'?'記録済みイベントを再生しています。':'Discord IPCのイベントを受信しています。';
 get('add').hidden=state.source!=='demo';get<HTMLButtonElement>('retry').disabled=state.source!=='ipc';
 get('seat-counts').textContent=`最大同時 ${state.session.peakPresentCount}人 · 予約 ${state.session.reservations.length}席 · 待機 ${state.session.waitingUserIds.length}人`;
 const people=dockPeople(state), ids=new Set(people.map(p=>p.userId));
 for(const [id,r]of rows)if(!ids.has(id)){r.element.remove();rows.delete(id);}
 let rowIndex=0;
 for(const user of people){let r=rows.get(user.userId);if(!r){r=row(user);rows.set(user.userId,r);}r.user=user;r.name.textContent=user.name;
  const hasSeat=user.slotIndex!==undefined;
  const presence=user.presence==='present'?(user.speaking==='active'?'発話中':user.speaking==='unknown'?'発話状態未確定':'無音'):user.presence==='absent'?(hasSeat?'退出・予約中':'退出・予約なし'):'在席確認待ち';
  const speech=state.speech.find(s=>s.userId===user.userId);
  r.status.textContent=`${hasSeat?'席 '+(user.slotIndex!+1):user.presence==='present'?'待機':'席なし'} · ${presence}${speech&&user.speaking==='active'?' · '+(speech.activeMs/1000).toFixed(1)+'秒'+(speech.qualified?' / 候補':''):''}`;
  r.element.dataset.userId=user.userId;r.element.dataset.speaking=user.speaking;r.element.dataset.presence=user.presence;
  r.focus.disabled=user.presence!=='present'||!hasSeat;
  r.speak.hidden=r.presence.hidden=state.source!=='demo'||!user.participant;
  r.speak.disabled=user.presence!=='present';r.speak.textContent=user.speaking==='active'?'発話 OFF':'発話 ON';
  r.presence.textContent=user.presence==='present'?'退出':'復帰';r.release.hidden=user.presence==='present'||!hasSeat;
  r.release.disabled=!user.canRelease;
  r.release.title=user.canRelease?'':'接続後に在席を確認してから解放できます';
  const at=get('participants').children[rowIndex++];
  if(at!==r.element)get('participants').insertBefore(r.element,at??null);
 }
};
const overlayUrl = new URL('/overlay', location.origin).href;
get<HTMLInputElement>('overlay-url').value=overlayUrl;
get<HTMLAnchorElement>('open-overlay').href=overlayUrl;
client.connect();
