import { expect, test } from 'bun:test';
import { FrameDecoder, Op, decodeObject, encodeFrame, encodeJson } from '../../src/discord/codec.ts';
import { APP } from '../../src/domain/defaults.ts';

test('UTF-8 frame survives every possible split, including byte-by-byte input', () => {
  const payload = { cmd: 'DISPATCH', data: { nick: '円卓🎙️' } };
  const bytes = encodeJson(Op.FRAME, payload);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = new FrameDecoder();
    const frames = [...decoder.push(bytes.subarray(0, split)), ...decoder.push(bytes.subarray(split))];
    expect(frames.length).toBe(1);
    expect(decodeObject(frames[0]!.payload)).toEqual(payload);
  }
  const decoder = new FrameDecoder();
  const frames = [...bytes].flatMap(byte => decoder.push(Uint8Array.of(byte)));
  expect(decodeObject(frames[0]!.payload)).toEqual(payload);
});
test('coalesced and empty frames preserve opcode and exact ping payload bytes', () => {
  const decoder = new FrameDecoder();
  const binary = Uint8Array.of(0, 255, 128, 3);
  const frames = decoder.push(Buffer.concat([encodeFrame(Op.PING, binary), encodeFrame(Op.PONG, new Uint8Array()), encodeJson(Op.FRAME, { cmd: 'A' })]));
  expect(frames.map(f => f.opcode)).toEqual([3, 4, 1]);
  expect([...frames[0]!.payload]).toEqual([...binary]);
  expect(frames[1]!.payload.length).toBe(0);
});
test('invalid opcode and excessive length are rejected before allocating a body', () => {
  for (const [opcode, size, code] of [[9, 0, 'RPC_INVALID_OPCODE'], [1, APP.maxFrameBytes + 1, 'RPC_FRAME_TOO_LARGE']] as const) {
    const bytes = Buffer.alloc(8); bytes.writeUInt32LE(opcode, 0); bytes.writeUInt32LE(size, 4);
    const decoder = new FrameDecoder();
    expect(() => decoder.push(bytes)).toThrow(code);
    expect(() => decoder.push(Buffer.alloc(1))).toThrow('RPC_DECODER_CLOSED');
  }
});
test('malformed UTF-8, invalid JSON, arrays and null never become RPC objects', () => {
  for (const bytes of [Buffer.from('{'), Buffer.from('null'), Buffer.from('[]'), Buffer.from([0xff])]) {
    expect(() => decodeObject(bytes)).toThrow('RPC_MALFORMED_JSON');
  }
});
