import type { AppSnapshot,Participant,ProviderEvent,SeatSession } from '../contracts/domain.ts';
/** Only normalized metadata enters recordings. Names, avatar URLs, tokens and real IDs never do. */
export class ProviderRecording {
  private rows:Array<{kind:'provider';atMs:number;event:ProviderEvent}>=[];
  private aliases=new Map<string,string>();private generations=new Map<number,number>();
  private session?:SeatSession;
  private origin=0;private end=0;private bytes=0;
  active=false;limitReached=false;
  private alias(type:string,value:string):string{
    const key=type+':'+value;let alias=this.aliases.get(key);
    if(!alias){alias=String(this.aliases.size+1);this.aliases.set(key,alias);}return alias;
  }
  private person(p:Participant):Participant{
    const userId=this.alias('user',p.userId);
    return {userId,channelId:this.alias('channel',p.channelId),username:'participant_'+userId,displayName:'参加者 '+userId,presence:p.presence,speaking:p.speaking,voice:{selfMute:!!p.voice.selfMute,selfDeaf:!!p.voice.selfDeaf,serverMute:!!p.voice.serverMute,serverDeaf:!!p.voice.serverDeaf}};
  }
  start(state:AppSnapshot):void{
    if(this.active)throw new Error('RECORDING_ALREADY_ACTIVE');
    if(state.source==='replay')throw new Error('CANNOT_RECORD_REPLAY');
    this.rows=[];this.aliases.clear();this.generations.clear();this.bytes=0;this.origin=state.serverNowMs;this.end=this.origin;this.limitReached=false;this.active=true;
    this.session={...structuredClone(state.session),sessionId:'recording-session',channelId:this.alias('channel',state.session.channelId),reservations:state.session.reservations.map(r=>({...r,userId:this.alias('user',r.userId),reservedAtUtc:new Date(0).toISOString()})),waitingUserIds:state.session.waitingUserIds.map(id=>this.alias('user',id)),moderatorIds:state.session.moderatorIds?.map(id=>this.alias('user',id))};
    const channel=state.channel?{channelId:this.alias('channel',state.channel.channelId),name:'Voice channel',kind:state.channel.kind}:null;
    this.push({type:'snapshot',channel,participants:state.participants.filter(p=>p.presence==='present').map(p=>this.person(p)),sourceGeneration:1,receivedAtMs:0},0);
    this.push({type:'connection',status:state.connection,sourceGeneration:1,receivedAtMs:0},0);
    for(const p of state.participants)if(p.presence==='present'&&p.speaking==='active')this.push({type:'speaking',userId:this.alias('user',p.userId),state:'active',sourceGeneration:1,receivedAtMs:0},0);
  }
  append(input:ProviderEvent,processingMs:number):void{
    if(!this.active)return;
    const atMs=Math.max(0,this.rows.at(-1)?.atMs??0,processingMs-this.origin);
    let generation=this.generations.get(input.sourceGeneration);
    if(!generation){generation=this.generations.size+1;this.generations.set(input.sourceGeneration,generation);}
    const meta={sourceGeneration:generation,receivedAtMs:atMs};let event:ProviderEvent;
    if(input.type==='connection')event={...meta,type:'connection',status:input.status};
    else if(input.type==='snapshot')event={...meta,type:'snapshot',channel:input.channel?{channelId:this.alias('channel',input.channel.channelId),name:'Voice channel',kind:input.channel.kind}:null,participants:input.participants.map(p=>this.person(p))};
    else if(input.type==='participant-upsert')event={...meta,type:'participant-upsert',participant:this.person(input.participant)};
    else if(input.type==='speaking')event={...meta,type:'speaking',userId:this.alias('user',input.userId),state:input.state};
    else event={...meta,type:'participant-left',userId:this.alias('user',input.userId)};
    this.push(event,atMs);this.end=processingMs;
  }
  private push(event:ProviderEvent,atMs:number):void{
    const row={kind:'provider' as const,atMs,event},bytes=Buffer.byteLength(JSON.stringify(row))+1;
    if(this.rows.length>=90000||this.bytes+bytes>14*1024*1024||atMs>86_399_000){this.active=false;this.limitReached=true;return;}
    this.rows.push(row);this.bytes+=bytes;
  }
  stop(now:number):void{if(this.active)this.end=now;this.active=false;}
  info(now:number){return {active:this.active,eventCount:this.rows.length,durationMs:Math.max(0,(this.active?now:this.end)-this.origin),limitReached:this.limitReached};}
  export(now:number):string{
    if(!this.rows.length)throw new Error('RECORDING_EMPTY');
    const durationMs=Math.min(86_400_000,Math.max(50,(this.active?now:this.end)-this.origin,(this.rows.at(-1)?.atMs??0)+1));
    const header={kind:'header',schemaVersion:1,originMs:0,durationMs,session:this.session,recording:'anonymized-provider-events',limitations:'Manual camera controls and custom assets are not recorded.'};
    return [JSON.stringify(header),...this.rows.map(r=>JSON.stringify(r))].join('\n')+'\n';
  }
}
