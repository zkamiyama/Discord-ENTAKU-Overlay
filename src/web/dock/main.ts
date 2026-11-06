import { StudioClient } from '../shared/client.ts';
import type { Participant } from '../../contracts/domain.ts';
const client=new StudioClient();
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
interface Row { element:HTMLElement; name:HTMLElement; status:HTMLElement; focus:HTMLButtonElement; speak:HTMLButtonElement; presence:HTMLButtonElement; release:HTMLButtonElement; user:Participant }
const rows=new Map<string,Row>();
function row(user:Participant):Row {
 const element=document.createElement('div');element.className='person';
 const heading=document.createElement('div');heading.className='person-header';const name=document.createElement('span');name.className='person-name';const status=document.createElement('span');status.className='person-state';heading.append(name,status);
 const buttons=document.createElement('div');buttons.className='person-buttons';
 const button=(text:string)=>{const b=document.createElement('button');b.textContent=text;buttons.append(b);return b;};
 const focus=button('この人を撮る'),speak=button('発話 ON'),presence=button('退出'),release=button('予約を解放');element.append(heading,buttons);
 const result={element,name,status,focus,speak,presence,release,user};
 focus.onclick=()=>void command({type:'single',userId:user.userId});
 speak.onclick=()=>void command({type:'demo-speaking',userId:user.userId,active:result.user.speaking!=='active'});
 presence.onclick=()=>void command({type:'demo-presence',userId:user.userId,present:result.user.presence!=='present'});
 release.onclick=()=>{if(confirm(`${result.user.displayName}の席予約を解放しますか？`))void command({type:'release',userId:user.userId,confirm:true});};
 get('participants').append(element);return result;
}
client.onState=state=>{
 get('mode').textContent=state.mode;get('shot').textContent=state.camera.shot.kind;get('reason').textContent=state.decision.reason;get('remaining').textContent=`${(state.decision.holdRemainingMs/1000).toFixed(1)} 秒`;
 const count=state.participants.filter(p=>p.presence==='present').length;
 get('counts').textContent=`${count}人 / ${state.session.capacity}席`;
 get('connection').textContent=`${state.connection} · ${state.channel?.name??'VC未選択'}${state.errorCode?' · '+state.errorCode:''}`;
 get('source').textContent=state.source==='demo'?'デモ入力です。発話ボタンでカメラ切替を試せます。':state.source==='replay'?'記録済みイベントを再生しています。':'Discord IPCのイベントを受信しています。';
 get('add').hidden=state.source!=='demo';get<HTMLButtonElement>('retry').disabled=state.source!=='ipc';
 const ids=new Set(state.participants.map(p=>p.userId));
 for(const [id,r]of rows)if(!ids.has(id)){r.element.remove();rows.delete(id);}
 for(const user of state.participants){let r=rows.get(user.userId);if(!r){r=row(user);rows.set(user.userId,r);}r.user=user;r.name.textContent=user.displayName;
  const seat=state.session.reservations.find(s=>s.userId===user.userId);r.status.textContent=`${seat?'席 '+(seat.slotIndex+1):'待機'} · ${user.presence==='present'?(user.speaking==='active'?'発話中':user.speaking==='unknown'?'発話状態未確定':'無音'):user.presence==='absent'?'退出・予約中':'接続待ち'}`;
  r.element.dataset.speaking=user.speaking;r.element.dataset.presence=user.presence;r.focus.disabled=user.presence!=='present'||!seat;
  r.speak.hidden=r.presence.hidden=state.source!=='demo';r.speak.disabled=user.presence!=='present';r.speak.textContent=user.speaking==='active'?'発話 OFF':'発話 ON';r.presence.textContent=user.presence==='present'?'退出':'復帰';r.release.hidden=user.presence==='present'||!seat;
 }
 if(client.overlayUrl){get<HTMLInputElement>('overlay-url').value=client.overlayUrl;get<HTMLAnchorElement>('open-overlay').href=client.overlayUrl;}
};
client.connect();
