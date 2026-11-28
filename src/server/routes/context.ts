import type {ServerOptions} from '../app.ts';
import type {SettingsService} from '../settings-service.ts';
import type {StudioStore} from '../../studio/store.ts';
import type {AvatarStore} from '../../assets/store.ts';
import type {PresetStore} from '../../presets/store.ts';
import type {AvatarCache} from '../avatar-cache.ts';
import type {ProviderRecording} from '../../diagnostics/recording.ts';
import type {VcChatFeed} from '../../chat/vc-chat-feed.ts';
import type {MisskeyFeed} from '../../misskey/feed.ts';
import type {MisskeyStream} from '../../misskey/stream.ts';
import type {RuntimeDiagnostics} from '../../contracts/diagnostics.ts';
import type {EnvironmentService} from '../environment-service.ts';
export interface RouteContext {
 options:ServerOptions;now:()=>number;settings:SettingsService;studioStore:StudioStore;
 customAssets:AvatarStore;presets:PresetStore;avatars:AvatarCache;recording:ProviderRecording;
 vcChat:VcChatFeed;diagnostic:()=>RuntimeDiagnostics;broadcast:()=>void;
 misskey:MisskeyFeed;misskeyStream:MisskeyStream|null;
 environment:EnvironmentService;
 serial:(work:()=>Promise<Response>,signal?:AbortSignal)=>Promise<Response>;
}
export type HttpRoute=(request:Request,url:URL,port:number)=>Promise<Response|undefined>;
