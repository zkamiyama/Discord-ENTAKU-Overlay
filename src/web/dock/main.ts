import type {Command} from '../../contracts/commands.ts';
import {DEFAULT_DIRECTION} from '../../studio/direction.ts';
import {VcChatPanel} from './vc-chat-panel.ts';
import {seatLabel} from '../../geometry/seat-label.ts';
import {PresetPanel} from './preset-panel.ts';
import {StudioPanel} from './studio-panel.ts';
import {DirectionPanel} from './direction-panel.ts';
import {installNumericControls,syncNumericControls} from './numeric-controls.ts';
import {PostPanel} from './post-panel.ts';
import {QualityPanel} from './quality-panel.ts';
import {ExposurePanel} from './exposure-panel.ts';
import {DiagnosticsPanel} from './diagnostics-panel.ts';
import {AvatarEditor} from './avatar-editor.ts';
import {StudioClient} from '../shared/client.ts';
import {dockPeople,type DockPerson} from './people.ts';
import {decorate,decorateShell,icon} from './icons.ts';
import {installTheme} from './theme.ts';
decorateShell();installTheme();
const client=new StudioClient(),editor=new AvatarEditor(client);new VcChatPanel(client);
const studioPanel=new StudioPanel(client),presetPanel=new PresetPanel(client);new DiagnosticsPanel(client);const exposurePanel=new ExposurePanel(client),qualityPanel=new QualityPanel(client),postPanel=new PostPanel(client),directionPanel=new DirectionPanel(client);
installNumericControls();
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const errors=get('error');let busy=false,replayShown=false;
async function command(value:Command,expectedRevision?:number):Promise<void>{
 if(busy)return;busy=true;errors.textContent='';
 try{await client.command(value,expectedRevision);}catch(e){errors.textContent=e instanceof Error?e.message:'操作に失敗しました';}finally{busy=false;}
}
get('auto').onclick=()=>void command({type:'mode',mode:client.state?.mode==='HOLD'?'AUTO':'HOLD'});
get('wide').onclick=()=>void command({type:'wide'});
get('retry').onclick=()=>{if(confirm('Discordの認可画面が表示される場合があります。再接続しますか？'))void command({type:'retry'});};
get('new-session').onclick=()=>{if(confirm('退出者の席予約を消し、現在の参加者で配置し直しますか？'))void command({type:'new-session',confirm:true});};
get('add').onclick=()=>void command({type:'demo-add'});
get('copy').onclick=()=>{const value=get<HTMLInputElement>('overlay-url').value;void navigator.clipboard.writeText(value).catch(()=>{get<HTMLInputElement>('overlay-url').closest('details')?.setAttribute('open','');get<HTMLInputElement>('overlay-url').select();errors.textContent='URL欄を選択しました。コピーしてください。';});};
client.onConnection=status=>{get('transport').textContent=status;};
interface Row {element:HTMLElement;seat:HTMLElement;name:HTMLElement;status:HTMLElement;duration:HTMLElement;focus:HTMLButtonElement;speak:HTMLButtonElement;more:HTMLButtonElement;user:DockPerson}
const rows=new Map<string,Row>(),menu=document.createElement('div');menu.className='context-menu';menu.setAttribute('role','menu');menu.hidden=true;document.body.append(menu);
let menuTrigger:HTMLButtonElement|null=null;
function closeMenu(restore=false){menu.hidden=true;menuTrigger?.setAttribute('aria-expanded','false');if(restore)menuTrigger?.focus();menuTrigger=null;}
document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target as Node)&&!menuTrigger?.contains(e.target as Node))closeMenu();});
menu.addEventListener('keydown',e=>{
 const items=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],current=items.indexOf(document.activeElement as HTMLButtonElement);
 if(e.key==='ArrowLeft'&&menu.dataset.submenu==='seats'){e.preventDefault();const row=[...rows.values()].find(r=>r.more===menuTrigger);closeMenu();if(row)openMenu(row);}
 else if(e.key==='Escape'){e.preventDefault();closeMenu(true);}else if(e.key==='Tab')closeMenu();
 else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(current+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
});
function openMenu(row:Row,seats=false):void{
 if(!seats&&menuTrigger===row.more&&!menu.hidden){closeMenu(true);return;}closeMenu();menu.replaceChildren();
 const user=row.user,state=client.state!,hosts=state.session.moderatorIds??[];menu.dataset.submenu=seats?'seats':'';
 const add=(glyph:string,label:string,fn:()=>void,disabled=false)=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');decorate(b,glyph,label,true);b.disabled=disabled;b.onclick=()=>{closeMenu();fn();};menu.append(b);return b;};
 if(seats){
  add('arrow-counter-clockwise','戻る',()=>{closeMenu();openMenu(row);});
  for(const seat of state.seats){const other=state.session.reservations.find(r=>r.slotIndex===seat.slotIndex),person=other?dockPeople(state).find(p=>p.userId===other.userId):undefined;
   const label=seatLabel(seat,state.seats)+(seat.slotIndex===user.slotIndex?'（現在）':person?`（${person.name}と入替）`:'（空席）');
   add('users',label,()=>void command({type:'seat-move',userId:user.userId,slotIndex:seat.slotIndex},state.revision),seat.slotIndex===user.slotIndex);
  }
 }else{
 add('image','画像を調整',()=>void editor.open(user.userId,user.name));
 add('crown','司会に指定',()=>void command({type:'moderators',userIds:[user.userId]}),user.slotIndex===undefined);
 add('users','共同司会に追加',()=>void command({type:'moderators',userIds:[...hosts,user.userId]}),user.slotIndex===undefined||hosts.includes(user.userId)||hosts.length>=2);
 if(hosts.includes(user.userId)&&hosts.length===2)add('users','司会指定を解除',()=>void command({type:'moderators',userIds:hosts.filter(id=>id!==user.userId)}));
 if(state.source==='demo'&&user.participant)add(user.presence==='present'?'sign-out':'sign-in',user.presence==='present'?'退出':'復帰',()=>void command({type:'demo-presence',userId:user.userId,present:user.presence!=='present'}));
 if(user.slotIndex!==undefined&&user.presence!=='present')add('trash','予約を解放',()=>{if(confirm(`${user.name}の席予約を解放しますか？`))void command({type:'release',userId:user.userId,confirm:true});},!user.canRelease);
 const move=add('users','席移動 ›',()=>openMenu(row,true),user.slotIndex===undefined);move.setAttribute('aria-haspopup','menu');
 move.onkeydown=e=>{if(e.key==='ArrowRight'){e.preventDefault();openMenu(row,true);}};
 }
 const rect=row.more.getBoundingClientRect();menu.hidden=false;menu.style.left=Math.max(8,Math.min(rect.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-menu.offsetHeight-8))+'px';
 menuTrigger=row.more;row.more.setAttribute('aria-expanded','true');menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
function row(user:DockPerson):Row {
 const element=document.createElement('div');element.className='person';element.dataset.userId=user.userId;
 const seat=document.createElement('span');seat.className='person-seat';const name=document.createElement('span');name.className='person-name';
 const status=document.createElement('span');status.className='person-state';const duration=document.createElement('span');status.append(icon('microphone'),duration);
 const buttons=document.createElement('div');buttons.className='person-buttons';
 const button=(glyph:string,label:string)=>{const b=document.createElement('button');b.type='button';decorate(b,glyph,label);buttons.append(b);return b;};
 const focus=button('camera','この人を撮る'),speak=button('microphone','発話 ON'),more=button('dots-three','参加者メニュー');more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');
 element.append(seat,name,status,buttons);const result={element,seat,name,status,duration,focus,speak,more,user};
 focus.onclick=()=>void command({type:'single',userId:user.userId});
 speak.onclick=()=>void command({type:'demo-speaking',userId:user.userId,active:result.user.speaking!=='active'});
 more.onclick=()=>openMenu(result);get('participants').append(element);return result;
}
const compositionNames:Record<string,string>={SPLIT:'左右2分割',WIDE:'全景',SINGLE_OTS:'肩越し',SINGLE_CLEAN:'単独',TWO_SHOT:'2人',MODERATOR_SINGLE:'司会',MODERATOR_TWO:'共同司会'};
const visibilityNames:Record<string,string>={OVER_SHOULDER:'肩越し',ELEVATED_TO_AVOID_OCCLUSION:'高さを補正',SHIFTED_TO_AVOID_OCCLUSION:'横位置を補正',FALLBACK_TO_CLEAN_SINGLE:'通常構図',NO_CLEAR_COMPOSITION:'見通しを確認',TARGET_UNAVAILABLE:'対象待ち'};
client.onState=state=>{
 const peopleById=new Map(state.participants.map(p=>[p.userId,p])),speechById=new Map(state.speech.map(p=>[p.userId,p]));
 exposurePanel.update(state);qualityPanel.update(state);postPanel.update(state);directionPanel.update(state);
 studioPanel.update(state);presetPanel.update(state);
 get('mode').textContent=state.mode;get('shot').textContent=state.camera.shot.kind;get('camera-transition').textContent=state.camera.transition;
 get('composition').textContent=compositionNames[state.camera.composition??state.camera.shot.kind]??state.camera.shot.kind;
 get('composition').dataset.composition=state.camera.composition??state.camera.shot.kind;
 const foreground=peopleById.get(state.camera.foregroundUserId??'');
 get('foreground').textContent=foreground?`前景：${foreground.displayName}`:'前景なし';
 get('visibility').textContent=visibilityNames[state.camera.visibilityReason??'']??'標準構図';
 const leader=peopleById.get(state.decision.leaderUserId??'');
 const led=speechById.get(leader?.userId??''),windowSeconds=state.studio.direction?.leadershipWindowSeconds??10;
 get('conversation-leader').textContent=leader?`主 ${leader.displayName} ${(Math.min(windowSeconds*1000,led?.speechWindowMs??0)/1000).toFixed(1)}秒`:'主話者なし';get('conversation-leader').title=`直近${windowSeconds}秒の実発話量`;
 const discussion=state.decision.dialogue;
 const reasons:Record<string,string>={NEED_TWO_SPEAKERS:'2人の発話待ち',THIRD_SPEAKER:'3人目が参加',INSUFFICIENT_SPEECH:'発話量待ち',NOT_A_TWO_PERSON_DISCUSSION:'他の話者も参加',BACKCHANNEL_OR_DOMINANCE:'主話者を優先',DISCUSSION_PAUSED:'会話の再開待ち',INSUFFICIENT_EXCHANGE:'交代・重なり待ち',SUSTAINED_OVERLAP:'同時発話が継続',RAPID_ALTERNATION:'交互の応酬',SPLIT_NO_SAFE_FRAMING:'安全な分割構図なし',ADJACENT_SHARED_CAMERA:'隣接席・1カメラ'};
 const thirdChecking=state.camera.shot.kind==='SPLIT'&&state.decision.pendingShot?.kind==='WIDE'&&discussion?.thirdActive;
 get('dialogue-state').textContent=!(state.studio.direction?.splitEnabled??DEFAULT_DIRECTION.splitEnabled)?'OFF':state.mode!=='AUTO'?'手動優先':thirdChecking?'3人目の発話を確認中':state.decision.reason==='THREE_PERSON_DISCUSSION'?'3人以上の会話・全景':state.decision.reason==='THIRD_SPEAKER_END_CONFIRM'?'言い淀み・再発話を確認中':state.decision.reason==='THIRD_SPEAKER_END_GRACE'?'会話の収束を確認中':state.camera.shot.kind==='SPLIT'?'左右2分割中':discussion?(reasons[discussion.reason]??discussion.reason):'判定待ち';
 get('dialogue-state').title=discussion?`2人の占有率 ${(discussion.pairShare*100).toFixed(0)}%・少ない側 ${(discussion.minorShare*100).toFixed(0)}%・交代 ${discussion.alternations}回・重なり ${(discussion.overlapMs/1000).toFixed(1)}秒`:'';
 const reason=state.camera.safetyReason??state.decision.reason;
 const reasonNames:Record<string,string>={SPEECH_START_GRACE:'発話確認',SPEECH_END_CONFIRM:'終了確認',SPEECH_END_GRACE:'終了猶予',SILENCE:'無音',BACKCHANNEL_IGNORED:'相槌・待機',SPEAKER_QUALIFIED:'発話中',DOMINANT_SPEAKER_WINDOW:'主話者',BALANCED_DIALOGUE:'対話',ADJACENT_SHARED_CAMERA:'隣接席',MANUAL_OVERRIDE:'手動',SOURCE_LOST:'接続待ち',LEADER_MARGIN:'主話者維持',SPEAKER_RESUMED:'発話再開',SPLIT_ACTIVE_DISCUSSION:'応酬',THREE_PERSON_DISCUSSION:'3人以上'};
 get('reason').textContent=reasonNames[reason]??reason;get('reason').title=reason;get('remaining').textContent=`${(state.decision.holdRemainingMs/1000).toFixed(1)} 秒`;
 get('auto').setAttribute('aria-pressed',String(state.mode!=='HOLD'));
 get('counts').textContent=`${state.participants.filter(p=>p.presence==='present').length}人 / ${state.session.capacity}席`;
 get('connection').textContent=`${state.channel?.name??'VC未選択'} · ${state.connection}${state.errorCode?' · '+state.errorCode:''}`;
 get('source').textContent=state.source==='demo'?'デモ入力：マイクボタンで発話を切り替えます。':state.source==='replay'?'記録済みイベントを再生中。':'Discord IPCから受信中。';
 get('add').hidden=state.source!=='demo';get<HTMLButtonElement>('retry').disabled=state.source!=='ipc';
 get('seat-counts').textContent=`最大同時 ${state.session.peakPresentCount}人 · 予約 ${state.session.reservations.length}席 · 待機 ${state.session.waitingUserIds.length}人`;
 if(state.source==='replay'&&!replayShown){get<HTMLDetailsElement>('diagnostics-section').open=true;replayShown=true;}
 const people=dockPeople(state),ids=new Set(people.map(p=>p.userId));
 for(const [id,r]of rows)if(!ids.has(id)){r.element.remove();rows.delete(id);}
 let index=0;
 for(const user of people){let r=rows.get(user.userId);if(!r){r=row(user);rows.set(user.userId,r);}r.user=user;if(r.name.textContent!==user.name){r.name.textContent=user.name;r.name.title=user.name;}
  const seat=user.slotIndex===undefined?undefined:state.seats[user.slotIndex],label=seat?seatLabel(seat,state.seats):'待機';
  if(r.seat.dataset.label!==label){r.seat.replaceChildren();if(seat?.zone==='moderator')r.seat.append(icon('crown'));else r.seat.textContent=label;r.seat.title=label;r.seat.setAttribute('aria-label',label);r.seat.dataset.label=label;}
  const presence=user.presence==='present'?(user.speaking==='active'?'発話中':user.speaking==='unknown'?'発話状態未確定':'無音'):user.presence==='absent'?'退出・予約中':'在席確認待ち';
  const speech=speechById.get(user.userId);r.duration.textContent=user.speaking==='active'?`${((speech?.activeMs??0)/1000).toFixed(1)}s`:user.presence==='present'?'—':'退出';
  r.status.title=`${label} · ${presence} · 直近${windowSeconds}秒 ${(Math.min(windowSeconds*1000,speech?.speechWindowMs??0)/1000).toFixed(1)}秒`;r.status.setAttribute('aria-label',`${label} · ${presence}`);
  Object.assign(r.element.dataset,{speaking:user.speaking,presence:user.presence,zone:seat?.zone??'',slot:String(user.slotIndex??'')});
  r.focus.disabled=user.presence!=='present'||!seat;r.focus.setAttribute('aria-pressed',String(state.camera.shot.userIds.some(id=>id===user.userId)));
  r.speak.hidden=state.source!=='demo'||!user.participant;r.speak.disabled=user.presence!=='present';
  const speakLabel=user.speaking==='active'?'発話 OFF':'発話 ON';if(r.speak.getAttribute('aria-label')!==speakLabel)decorate(r.speak,user.speaking==='active'?'microphone-slash':'microphone',speakLabel);
  const at=get('participants').children[index++];if(at!==r.element)get('participants').insertBefore(r.element,at??null);
 }
 syncNumericControls();
};
const overlayUrl=new URL('/overlay',location.origin).href;get<HTMLInputElement>('overlay-url').value=overlayUrl;get<HTMLAnchorElement>('open-overlay').href=overlayUrl;client.connect();
