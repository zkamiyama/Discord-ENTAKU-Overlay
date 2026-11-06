import type { StudioScene } from '../studio/manifest.ts';
import type { AvatarProfile } from '../assets/avatar-profile.ts';
export type SpeakingState = 'active' | 'inactive' | 'unknown';
export type Presence = 'present' | 'absent' | 'stale';
export type ConnectionStatus = 'disconnected' | 'discovering' | 'authorizing' | 'subscribing' | 'syncing' | 'ready' | 'degraded' | 'auth-required';
export type Vec3 = readonly [number, number, number];
export interface Participant {
  userId: string; channelId: string; username: string; displayName: string;
  avatarUrl?: string; nick?: string; globalName?: string;
  presence: Presence; speaking: SpeakingState;
  voice: { selfMute: boolean; selfDeaf: boolean; serverMute: boolean; serverDeaf: boolean };
}
export interface Channel { channelId: string; name: string; guildId?: string; kind: 'guild-voice' | 'unsupported' }
export type ProviderEvent = { sourceGeneration: number; receivedAtMs: number } & (
  | { type: 'connection'; status: ConnectionStatus; errorCode?: string }
  | { type: 'snapshot'; channel: Channel | null; participants: Participant[] }
  | { type: 'participant-upsert'; participant: Participant }
  | { type: 'participant-left'; userId: string }
  | { type: 'speaking'; userId: string; state: 'active' | 'inactive' }
);
export interface Reservation { userId: string; seatId: string; slotIndex: number; reservedAtUtc: string }
export interface SeatSession {
  schemaVersion: 1; sessionId: string; channelId: string; revision: number;
  minSeats: number; capacity: number; peakPresentCount: number; seatPitch?: number;
  reservations: Reservation[]; waitingUserIds: string[];
}
export interface SeatTransform { slotIndex: number; position: Vec3; inward: Vec3; baseYawRad: number; faceAnchor: Vec3 }
export type Shot = { kind: 'WIDE'; userIds: [] } | { kind: 'SINGLE'; userIds: [string] } | { kind: 'TWO_SHOT'; userIds: [string, string] };
export type DirectorMode = 'AUTO' | 'MANUAL' | 'HOLD';
export interface Decision { shot: Shot; reason: string; changed: boolean; holdRemainingMs: number }
export interface CameraPose { position: Vec3; target: Vec3; fov: number }
export interface CameraPlan {
  id: number; shot: Shot; reason: string; transition: 'CUT' | 'MOVE';
  from: CameraPose; to: CameraPose; startMs: number; durationMs: number;
  studioHidden?: boolean; safetyReason?: string;
}
export interface AppSnapshot {
  protocolVersion: 1; serverEpoch: string; seq: number; revision: number; serverNowMs: number; clockRate?: number;
  connection: ConnectionStatus; errorCode?: string; channel: Channel | null;
  studio: StudioScene;
  speech:Array<{userId:string;activeMs:number;ratio:number;qualified:boolean}>;
  avatarProfiles: AvatarProfile[];
  participants: Participant[]; session: SeatSession; straightLength: number; seats: SeatTransform[];
  layoutMotion?: { fromSeats: SeatTransform[]; fromStraightLength: number; startMs: number; durationMs: number };
  mode: DirectorMode; decision: Decision; camera: CameraPlan; source: 'demo' | 'replay' | 'ipc';
}
