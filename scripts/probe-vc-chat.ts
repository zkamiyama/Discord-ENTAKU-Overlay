import {randomUUID} from 'node:crypto';
import {StreamKitCompatAuth} from '../src/discord/auth-provider.ts';
import {IpcVoiceProvider} from '../src/discord/ipc-voice-provider.ts';
import {VERSION} from '../src/version.ts';

export interface ProbeArguments {consent:boolean;metadataOnly:boolean;seconds:number;help:boolean}
export function parseProbeArguments(args:readonly string[]):ProbeArguments {
 const result:ProbeArguments={consent:false,metadataOnly:false,seconds:120,help:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--accept-streamkit-compat')result.consent=true;
  else if(arg==='--metadata-only')result.metadataOnly=true;
  else if(arg==='--help')result.help=true;
  else if(arg==='--seconds'){
   const value=args[++i];if(!value||!/^\d+$/.test(value)||Number(value)<5||Number(value)>3600)throw new Error('PROBE_SECONDS_INVALID');result.seconds=Number(value);
  }else throw new Error('PROBE_ARGUMENT_INVALID');
 }
 return result;
}
export async function runProbe(args=process.argv.slice(2),sourceCommit='working-tree'):Promise<void>{
 const options=parseProbeArguments(args);
 if(options.help){console.log('ENTAKU VC chat probe (terminal only)\nSet ENTAKU_PROBE_VC_CHAT=1, then run with --accept-streamkit-compat.\nOptions: --seconds 5..3600 (default 120), --metadata-only, --help\nOptional: ENTAKU_PROBE_DISCORD_VERSION=<client version from Discord settings>.\nNo Bot, message sending, UI, or persisted chat. Requested scopes remain rpc,rpc.voice.read.');return;}
 if(process.env.ENTAKU_PROBE_VC_CHAT!=='1')throw new Error('PROBE_DISABLED_SET_ENTAKU_PROBE_VC_CHAT_1');
 if(!options.consent)throw new Error('COMPAT_CONSENT_REQUIRED');
 const testMessage='ENTAKU_VC_CHAT_TEST_'+randomUUID();
 console.log(`[VC-CHAT-PROBE] app=${VERSION} source=${sourceCommit} platform=${process.platform} transport=IPC`);
 console.log('[VC-CHAT-PROBE] Existing StreamKit compatibility authentication only; no extra scopes requested.');
 console.log('[VC-CHAT-PROBE] After SUBSCRIBE success, post this exact text from ANOTHER account in the selected server VC chat:');
 console.log(testMessage);
 if(!options.metadataOnly)console.log('[VC-CHAT-PROBE] New chat author/content appears only in this terminal. Use a test VC; do not redirect terminal output to a log.');
 let voiceReady=false,voiceStatus='not-started';
 const auth=new StreamKitCompatAuth(true);
 const provider=new IpcVoiceProvider(auth,event=>{
  if(event.type==='connection'){
   voiceStatus=event.status;if(event.status==='ready')voiceReady=true;
   console.log(`[VC-CHAT-PROBE] voice_status=${event.status}${event.errorCode?' error='+event.errorCode:''}`);
  }
 },undefined,undefined,{metadataOnly:options.metadataOnly,testMessage});
 let finish!:()=>void;const finished=new Promise<void>(resolve=>{finish=resolve;});
 const timeout=setTimeout(finish,options.seconds*1000),signal=()=>finish();
 const check=setInterval(()=>{const result=provider.chatProbeSummary();if(result?.subscription==='success'&&result.verifiedTestEvents>0)finish();},100);
 process.on('SIGINT',signal);process.on('SIGTERM',signal);
 provider.start();
 try{await finished;}
 finally{clearTimeout(timeout);clearInterval(check);process.off('SIGINT',signal);process.off('SIGTERM',signal);await provider.stop();}
 const result=provider.chatProbeSummary()!;
 const confirmed=result.subscription==='success'&&result.verifiedTestEvents>0;
 // Successful SUBSCRIBE or GET_CHANNEL.messages alone is deliberately not PASS.
 console.log('[VC-CHAT-PROBE] SUMMARY '+JSON.stringify({...result,voiceReady,voiceStatus,
  verdict:confirmed?'PASS_OTHER_ACCOUNT_NEW_TEST_MESSAGE':result.subscription==='failed'?'SUBSCRIPTION_FAILED':result.matchedEvents?'EVENT_SEEN_TEST_NOT_CONFIRMED':'NOT_CONFIRMED'}));
 process.exitCode=confirmed?0:2;
}
export async function probeEntry(sourceCommit?:string):Promise<void>{
 try{await runProbe(process.argv.slice(2),sourceCommit);}
 catch(error){console.error(error instanceof Error&&/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:'PROBE_FAILED');process.exitCode=2;}
}
if(import.meta.main)await probeEntry();
