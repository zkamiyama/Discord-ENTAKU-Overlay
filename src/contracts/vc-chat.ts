/** Read-only chat travels separately from voice snapshots, recordings and presets. */
export type VcChatStatus = 'unavailable' | 'connecting' | 'no-channel' | 'unsupported' | 'subscribing' | 'live' | 'error' | 'disconnected';
export interface VcChatMessage {
  id: string; channelId: string; authorId: string; authorName: string;
  content: string; timestamp: string; editedTimestamp: string | null;
  attachmentCount: number; truncated: boolean;
}
export interface VcChatState {
  revision: number; status: VcChatStatus; channelId: string | null; channelName: string | null;
  errorCode: string | null; rpcCode: number | null;
  updates: boolean | null; deletions: boolean | null;
  messages: VcChatMessage[];
}
export const CHAT_LIMIT = 100;
export const CHAT_BYTE_LIMIT = 256 * 1024;
export function emptyVcChat(status: VcChatStatus = 'unavailable'): VcChatState {
  return {revision:0,status,channelId:null,channelName:null,errorCode:null,rpcCode:null,updates:null,deletions:null,messages:[]};
}
