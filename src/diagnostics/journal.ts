import type { AppSnapshot,ProviderEvent } from '../contracts/domain.ts';
export interface DiagnosticEntry{seq:number;atMs:number;kind:string;code:string;count?:number}
export class DiagnosticJournal{
  private rows:DiagnosticEntry[]=[];private seq=0;private previous='';
  add(atMs:number,kind:string,code:string,count?:number):void{
    this.rows.push({seq:++this.seq,atMs,kind,code,...(count===undefined?{}:{count})});if(this.rows.length>1000)this.rows.shift();
  }
  event(event:ProviderEvent,atMs:number):void{
    const code=event.type==='connection'?event.status:event.type==='speaking'?event.state:event.type;
    this.add(atMs,'provider',code,event.type==='snapshot'?event.participants.length:undefined);
  }
  state(state:AppSnapshot):void{
    const key=[state.camera.id,state.camera.safetyReason,state.mode,state.connection].join(':');
    if(key===this.previous)return;this.previous=key;
    this.add(state.serverNowMs,'camera',state.camera.safetyReason??state.camera.reason);
  }
  snapshot():DiagnosticEntry[]{return structuredClone(this.rows);}
}
