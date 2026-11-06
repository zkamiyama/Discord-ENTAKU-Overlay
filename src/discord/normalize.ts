import type { Channel, Participant } from '../contracts/domain.ts';
import { DiscordError } from './errors.ts';
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DiscordError('RPC_INVALID_DATA');
  return value as Record<string, unknown>;
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new DiscordError('RPC_INVALID_ID');
  return value;
}
export function normalizeParticipant(value: unknown, channelId: string): Participant {
  const p=object(value),u=object(p.user),v=object(p.voice_state ?? {}),userId=id(u.id);
  const text=(x:unknown):string|undefined=>typeof x==='string'&&x.length>0?x.slice(0,512):undefined;
  const username=text(u.username)??`user-${userId.slice(-4)}`,nick=text(p.nick),globalName=text(u.global_name);
  const hash=typeof u.avatar==='string'&&/^[a-zA-Z0-9_]{1,128}$/.test(u.avatar)?u.avatar:undefined;
  return {userId,channelId,username,displayName:nick??globalName??username,nick,globalName,
    ...(hash?{avatarUrl:`https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=256`}:{}),
    presence:'present',speaking:'unknown',voice:{selfMute:v.self_mute===true,selfDeaf:v.self_deaf===true,serverMute:v.mute===true,serverDeaf:v.deaf===true}};
}
export function normalizeSnapshot(value: unknown): {channel:Channel|null;participants:Participant[]} {
  if(value===null)return {channel:null,participants:[]};
  const c=object(value),channelId=id(c.id);
  const channel:Channel={channelId,name:typeof c.name==='string'?c.name.slice(0,512):channelId,kind:c.type===2?'guild-voice':'unsupported',...(typeof c.guild_id==='string'?{guildId:id(c.guild_id)}:{})};
  if(channel.kind==='unsupported')return {channel,participants:[]};
  if(!Array.isArray(c.voice_states)||c.voice_states.length>1024)throw new DiscordError('SNAPSHOT_INCONSISTENT');
  const participants=c.voice_states.map(p=>normalizeParticipant(p,channelId));
  if(new Set(participants.map(p=>p.userId)).size!==participants.length)throw new DiscordError('SNAPSHOT_INCONSISTENT');
  return {channel,participants};
}
