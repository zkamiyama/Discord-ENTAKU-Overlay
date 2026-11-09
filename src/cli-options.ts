import { VERSION } from './version.ts';
export interface Options {
  mode: 'demo' | 'ipc' | 'replay'; replayPath?: string; doctor: boolean; clientId?: string;
  compatibility: boolean; consent: boolean; safeMode: boolean; noOpen: boolean;
  port: number; dataDir?: string; help: boolean; version: boolean;
}
export function parseOptions(args: readonly string[]): Options {
  const result:Options={mode:'demo',doctor:false,compatibility:false,consent:false,safeMode:false,noOpen:false,port:31337,help:false,version:false};
  let modes=0;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    const value=()=>{const v=args[++i];if(!v||v.startsWith('--'))throw new Error('MISSING_ARGUMENT');return v;};
    if(arg==='--help'||arg==='-h')result.help=true;
    else if(arg==='--version')result.version=true;
    else if(arg==='--doctor')result.doctor=true;
    else if(arg==='--json'){/* doctor already uses JSON */}
    else if(arg==='--demo'){result.mode='demo';modes++;}
    else if(arg==='--live'){result.mode='ipc';modes++;}
    else if(arg==='--replay'){result.mode='replay';result.replayPath=value();modes++;}
    else if(arg==='--compat-auth')result.compatibility=true;
    else if(arg==='--accept-streamkit-compat')result.consent=true;
    else if(arg==='--safe-mode')result.safeMode=true;
    else if(arg==='--no-open')result.noOpen=true;
    else if(arg==='--data-dir')result.dataDir=value();
    else if(arg==='--client-id'){result.clientId=value();if(!/^\d{1,20}$/.test(result.clientId))throw new Error('INVALID_CLIENT_ID');}
    else if(arg==='--port'){const v=value();if(!/^\d+$/.test(v))throw new Error('INVALID_PORT');result.port=Number(v);if(result.port<0||result.port>65535)throw new Error('INVALID_PORT');}
    else throw new Error('UNKNOWN_ARGUMENT');
  }
  if(modes>1)throw new Error('CONFLICTING_MODES');
  if(result.help||result.version)return result;
  if(result.doctor&&(result.mode==='ipc'||result.replayPath||result.compatibility||result.consent))throw new Error('DOCTOR_DOES_NOT_AUTHORIZE');
  if(result.mode==='ipc'&&(!result.compatibility||!result.consent))throw new Error('COMPAT_CONSENT_REQUIRED');
  if(result.clientId&&!result.doctor)throw new Error('CLIENT_ID_IS_DOCTOR_ONLY');
  return result;
}
export const HELP=`Discord ENTAKU Overlay ${VERSION}

Usage:
  ENTAKU-Overlay.exe [--demo] [--no-open] [--port 31337]
  ENTAKU-Overlay.exe --replay FILE.jsonl [--no-open]
  ENTAKU-Overlay.exe --live --compat-auth --accept-streamkit-compat
  ENTAKU-Overlay.exe --doctor [--client-id YOUR_APPLICATION_ID]

Options:
  --data-dir DIRECTORY       External settings and reserved seats
  --safe-mode                Fresh in-memory settings; existing data is not changed
  --no-open                  Do not open the Dock in a browser
  --doctor                   Offline environment report; no authorization
  --client-id ID             Doctor only: explicit local IPC handshake probe
  --help / --version         Print information and exit

No arguments starts a DEMO, not a Discord authorization request.
The live compatibility route is unofficial and identifies as StreamKit.
It requires your explicit opt-in and Discord's consent dialog.
It reads voice participants, speaking state and accessible VC text chat.
It never records audio, sends chat or requests voice-write scopes.
This is a development build; live Discord/OBS acceptance is not complete.
`;
