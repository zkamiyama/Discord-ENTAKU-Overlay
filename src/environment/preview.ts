import type {Participant} from '../contracts/domain.ts';
import {AppEngine} from '../domain/engine.ts';
import type {SettingsSnapshot} from '../storage/settings-schema.ts';

/** A private, neutral roster for checking a received setup without joining or
 * changing the real voice channel. It never subscribes to a live provider. */
export function createEnvironmentPreview(settings:SettingsSnapshot,now=0):AppEngine|null {
  const people=settings.environment;
  if(!people)return null;
  const channelId='200',present=new Set(people.presentUserIds);
  const engine=new AppEngine({source:'demo',serverEpoch:`environment-${crypto.randomUUID()}`,
    studio:settings.studio,avatarProfiles:settings.avatarProfiles,
    seatingDefaults:settings.preferences?.seating,autoCamera:settings.preferences?.autoCamera,
    sessionId:()=>`environment-${settings.generation}`});
  const participants:Participant[]=people.identities.filter(person=>present.has(person.userId)).map(person=>({
    ...person,channelId,presence:'present',speaking:'unknown',
    voice:{selfMute:false,selfDeaf:false,serverMute:false,serverDeaf:false},
  }));
  engine.apply({type:'connection',status:'ready',sourceGeneration:1,receivedAtMs:now});
  engine.apply({type:'snapshot',channel:{channelId,name:'パッケージの表示確認',kind:'guild-voice'},
    participants,sourceGeneration:1,receivedAtMs:now});
  return engine;
}
