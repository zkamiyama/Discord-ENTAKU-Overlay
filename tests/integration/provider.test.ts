import { expect, test } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameDecoder, decodeObject, encodeFrame, encodeJson, Op } from '../../src/discord/codec.ts';
import { IpcVoiceProvider } from '../../src/discord/ipc-voice-provider.ts';
import type { AuthProvider } from '../../src/discord/auth-provider.ts';
import type { ProviderEvent } from '../../src/contracts/domain.ts';

function eventually<T>(predicate: () => T | undefined, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const until = performance.now() + timeoutMs;
    const timer = setInterval(() => {
      const value = predicate();
      if (value !== undefined) { clearInterval(timer); resolve(value); }
      else if (performance.now() > until) { clearInterval(timer); reject(new Error('TEST_TIMEOUT')); }
    }, 5);
  });
}
test('provider buffers initial events, subscribes channel scope and closes without leaking a task', async () => {
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\entaku-provider-${randomUUID()}` : join(tmpdir(), `ep-${randomUUID()}.sock`);
  const events: ProviderEvent[] = [], subscriptions: Record<string, unknown>[] = [];
  const sockets = new Set<Socket>();
  let channelReads = 0;
  const channel = { id: '200', type: 2, name: 'Mock VC', voice_states: [{ user: { id: '100', username: 'Mock User' }, nick: '仮名', voice_state: {} }] };
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    socket.on('data', chunk => {
      for (const frame of decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)) {
        if (frame.opcode === Op.HANDSHAKE) { socket.write(encodeJson(Op.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {} })); continue; }
        if (frame.opcode === Op.PING) { socket.write(encodeFrame(Op.PONG, frame.payload)); continue; }
        const request = decodeObject(frame.payload);
        let data: unknown = {};
        if (request.cmd === 'GET_SELECTED_VOICE_CHANNEL' || request.cmd === 'GET_CHANNEL') data = channel;
        if (request.cmd === 'SUBSCRIBE') {subscriptions.push(request);data={evt:request.evt};}
        if (request.cmd === 'GET_CHANNEL' && channelReads++ === 0) {
          socket.write(encodeJson(Op.FRAME, { cmd: 'DISPATCH', evt: 'SPEAKING_START', data: { user_id: '100' } }));
        }
        socket.write(encodeJson(Op.FRAME, { cmd: request.cmd, nonce: request.nonce, data }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  let authCalls = 0;
  const auth: AuthProvider = { clientId: '123', authenticate: async () => { authCalls++; }, clear() {} };
  const provider = new IpcVoiceProvider(auth, event => events.push(event), () => performance.now(), [path]);
  try {
    provider.start();
    await eventually(() => events.find(e => e.type === 'connection' && e.status === 'ready'));
    await eventually(() => channelReads >= 2 && provider.vcChat.snapshot().deletions===true ? true : undefined);
    const snapshotIndex = events.findIndex(e => e.type === 'snapshot');
    const speakingIndex = events.findIndex(e => e.type === 'speaking');
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(speakingIndex).toBeGreaterThan(snapshotIndex);
    expect(events[speakingIndex]).toMatchObject({ type: 'speaking', userId: '100', state: 'active', sourceGeneration: 1 });
    expect(subscriptions.filter(s => s.evt !== 'VOICE_CHANNEL_SELECT').every(s => (s.args as Record<string, unknown>).channel_id === '200')).toBe(true);
    expect(subscriptions).toHaveLength(9);
    expect(subscriptions.filter(s=>String(s.evt).startsWith('MESSAGE_')).map(s=>s.evt)).toEqual(['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE']);
    expect(authCalls).toBe(1);
  } finally {
    await provider.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
