import { APP } from '../domain/defaults.ts';
import { DiscordError } from './errors.ts';

export const Op = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;
export interface Frame { opcode: number; payload: Buffer }

export function encodeFrame(opcode: number, payload: Uint8Array): Buffer {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 4) throw new DiscordError('RPC_INVALID_OPCODE');
  if (payload.byteLength > APP.maxFrameBytes) throw new DiscordError('RPC_FRAME_TOO_LARGE');
  const output = Buffer.allocUnsafe(8 + payload.byteLength);
  output.writeUInt32LE(opcode, 0);
  output.writeUInt32LE(payload.byteLength, 4);
  output.set(payload, 8);
  return output;
}
export function encodeJson(opcode: number, value: unknown): Buffer {
  return encodeFrame(opcode, Buffer.from(JSON.stringify(value), 'utf8'));
}
export function decodeObject(payload: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new DiscordError('RPC_MALFORMED_JSON'); }
}

/** Incremental bounded parser. Payload bytes are copied once, including 1-byte reads. */
export class FrameDecoder {
  private header = Buffer.alloc(8);
  private headerUsed = 0;
  private body: Buffer | null = null;
  private bodyUsed = 0;
  private opcode = 0;
  private failed = false;

  push(chunk: Uint8Array): Frame[] {
    if (this.failed) throw new DiscordError('RPC_DECODER_CLOSED');
    const frames: Frame[] = [];
    let offset = 0;
    try {
      while (offset < chunk.byteLength) {
        if (this.body === null) {
          const count = Math.min(8 - this.headerUsed, chunk.byteLength - offset);
          this.header.set(chunk.subarray(offset, offset + count), this.headerUsed);
          this.headerUsed += count;
          offset += count;
          if (this.headerUsed < 8) continue;
          this.opcode = this.header.readUInt32LE(0);
          const length = this.header.readUInt32LE(4);
          if (this.opcode > 4) throw new DiscordError('RPC_INVALID_OPCODE');
          if (length > APP.maxFrameBytes) throw new DiscordError('RPC_FRAME_TOO_LARGE');
          this.body = Buffer.allocUnsafe(length);
          this.bodyUsed = 0;
        }
        const count = Math.min(this.body.length - this.bodyUsed, chunk.byteLength - offset);
        this.body.set(chunk.subarray(offset, offset + count), this.bodyUsed);
        offset += count;
        this.bodyUsed += count;
        if (this.bodyUsed === this.body.length) {
          frames.push({ opcode: this.opcode, payload: this.body });
          this.body = null;
          this.headerUsed = 0;
        }
      }
      return frames;
    } catch (error) {
      this.failed = true;
      this.body = null;
      throw error;
    }
  }
}
