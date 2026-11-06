import { dirname, join, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseOptions, HELP } from './cli-options.ts';
import { AppEngine } from './domain/engine.ts';
import { SessionStore } from './domain/session-store.ts';
import { IpcVoiceProvider } from './discord/ipc-voice-provider.ts';
import { StreamKitCompatAuth } from './discord/auth-provider.ts';
import { discover, ipcCandidates } from './discord/discovery.ts';
import { errorCode } from './discord/errors.ts';
import { loadAccessKeys, newAccessKeys } from './server/security.ts';
import { startServer, type WebAssets } from './server/app.ts';
import { demoEvents } from './replay/demo.ts';
import { parseReplay, ReplayPlayer } from './replay/player.ts';

function openBrowser(url:string):void {
  const command=process.platform==='win32'?['rundll32.exe','url.dll,FileProtocolHandler',url]:process.platform==='darwin'?['open',url]:['xdg-open',url];
  const child=spawn(command[0]!,command.slice(1),{stdio:'ignore',detached:true});
  child.on('error',()=>console.error('BROWSER_OPEN_FAILED: open the Dock URL manually.'));child.unref();
}
export async function main(embeddedAssets?: WebAssets, compiled=false, args=process.argv.slice(2)):Promise<void> {
  const options=parseOptions(args);
  if(options.help){console.log(HELP);return;}
  if(options.version){console.log('0.1.0-dev.1');return;}
  if(options.doctor){
    const report:Record<string,unknown>={application:'Discord ENTAKU Overlay',version:'0.1.0-dev.1',runtime:Bun.version,platform:process.platform,arch:process.arch,compiled,transport:process.platform==='win32'?'named-pipe':'unix-socket',candidateCount:ipcCandidates().length,probe:'not-requested',authorization:'not-attempted'};
    if(options.clientId){
      try{const found=await discover(options.clientId);found.client.close();report.probe='ready';}
      catch(e){report.probe=errorCode(e);process.exitCode=1;}
    }
    console.log(JSON.stringify(report,null,2));return;
  }
  const assets=embeddedAssets??JSON.parse(await readFile(resolve('.generated/web-assets.json'),'utf8')) as WebAssets;
  const dataDir=resolve(options.dataDir??(compiled?join(dirname(process.execPath),'data'):join(process.cwd(),'data')));
  const keys=options.safeMode?newAccessKeys():await loadAccessKeys(dataDir);
  const store=new SessionStore(join(dataDir,'sessions',options.mode));
  const replay=options.replayPath?await (async()=>{if((await stat(options.replayPath!)).size>16*1024*1024)throw new Error('REPLAY_TOO_LARGE');return parseReplay(await readFile(options.replayPath!,'utf8'));})():null;
  const sessions=replay?.session?[replay.session]:options.safeMode||options.mode==='replay'?[]:await store.loadAll();
  const start=performance.now();
  const engine=new AppEngine({source:options.mode,serverEpoch:randomUUID(),sessions,
    ...(options.mode==='replay'?{utcNow:()=>new Date(0).toISOString(),sessionId:()=> 'replay-session'}:{})});
  const player=replay?new ReplayPlayer(replay,engine):null;
  const now=()=>player?player.elapsedMs:performance.now()-start;
  if(options.mode==='demo')for(const event of demoEvents())engine.apply(event);
  if(player)player.advanceTo(0);
  let persistChain=Promise.resolve(),storageFailed=false;
  const saved=new Map(sessions.map(s=>[s.channelId,`${s.sessionId}:${s.revision}`]));
  const persist=():void=>{
    if(options.safeMode||options.mode==='replay')return;
    for(const session of engine.sessions()){
      const signature=`${session.sessionId}:${session.revision}`;if(saved.get(session.channelId)===signature)continue;saved.set(session.channelId,signature);
      persistChain=persistChain.then(()=>store.save(session)).catch(()=>{saved.delete(session.channelId);storageFailed=true;console.error('SESSION_WRITE_FAILED: reserved seats could not be saved.');});
    }
  };
  let provider:IpcVoiceProvider|null=null,retrying=false;
  const retry=()=>{
    if(!provider||retrying)return;retrying=true;
    void provider.stop().then(()=>provider?.start()).finally(()=>{retrying=false;});
  };
  const app=startServer({engine,keys,assets,port:options.port,now,onChange:persist,
    ...(player?{tick:()=>player.advanceTo(Math.min(player.replay.durationMs,performance.now()-start))}:{}),
    ...(options.mode==='ipc'?{retry}:{})});
  if(options.mode==='ipc'){
    console.log('Compatibility authentication explicitly enabled. Discord may show a StreamKit consent dialog.');
    const auth=new StreamKitCompatAuth(options.consent);
    provider=new IpcVoiceProvider(auth,event=>{engine.apply(event,now());app.broadcast();persist();},now);
    provider.start();
  }
  // Local capabilities are printed once for OBS setup, never put into diagnostics or event logs.
  console.log(`ENTAKU development server (${options.mode})\nOverlay: ${app.urls.overlay}\nDock:    ${app.urls.dock}`);
  console.log('Keep these local URLs private. Press Ctrl+C to stop.');
  if(!options.noOpen)openBrowser(app.urls.dock);
  const persistenceTimer=setInterval(persist,1000);
  let stopping=false;
  await new Promise<void>(resolveStopped=>{
    const shutdown=()=>{
      if(stopping)return;stopping=true;clearInterval(persistenceTimer);
      void (async()=>{
        await provider?.stop();persist();await persistChain;await app.stop();
        process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);
        if(storageFailed)process.exitCode=1;resolveStopped();
      })().catch(()=>{console.error('SHUTDOWN_FAILED');process.exitCode=1;resolveStopped();});
    };
    process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  });
}
export async function entry(assets?:WebAssets,compiled=false):Promise<void>{
  try{await main(assets,compiled);}catch(error){
    const e=error as NodeJS.ErrnoException;
    const code=e.code==='EADDRINUSE'?'PORT_IN_USE':e.code==='EACCES'?'DATA_PATH_PERMISSION_DENIED':error instanceof Error&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)?error.message:'STARTUP_FAILED';
    console.error(code);if(code==='COMPAT_CONSENT_REQUIRED')console.error('Read --help before explicitly opting into compatibility authentication.');
    process.exitCode=2;
  }
}
if(import.meta.main)await entry();
