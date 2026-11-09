import {DiscordError} from '../../src/discord/errors.ts';
import { afterEach, expect, test } from 'bun:test';
import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameDecoder, Op, decodeObject, encodeFrame, encodeJson, type Frame } from '../../src/discord/codec.ts';
import { RpcClient, type RpcOptions } from '../../src/discord/rpc-client.ts';
import { ipcCandidates } from '../../src/discord/discovery.ts';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fakePeer(handler: (frame: Frame, socket: Socket) => void, heartbeat = true, options:RpcOptions = {}) {
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\entaku-test-${randomUUID()}` : join(tmpdir(), `entaku-${randomUUID()}.sock`);
  const sockets = new Set<Socket>();
  const server: Server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    socket.on('data', bytes => {
      for (const frame of decoder.push(typeof bytes === 'string' ? Buffer.from(bytes) : bytes)) {
        if (frame.opcode === Op.HANDSHAKE) socket.write(encodeJson(Op.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
        else if (frame.opcode === Op.PING && heartbeat) {
          // Discord peers decode IPC control payloads as JSON. Do not let the
          // mock accidentally accept the old unquoted UUID wire format.
          try{JSON.parse(frame.payload.toString('utf8'));socket.write(encodeFrame(Op.PONG,frame.payload));}
          catch{socket.write(encodeJson(Op.CLOSE,{code:4002,message:'invalid JSON'}));}
        }
        else handler(frame, socket);
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  cleanup.push(async () => { for (const s of sockets) s.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const client = await RpcClient.connect(path, '123', { heartbeatMs: heartbeat ? 20 : 10, ...options });
  cleanup.push(() => client.close());
  return client;
}
test('responses correlate by nonce, not arrival order', async () => {
  const queued: Record<string, unknown>[] = [];
  const client = await fakePeer((frame, socket) => {
    const packet = decodeObject(frame.payload); queued.push(packet);
    if (queued.length === 2) for (const p of queued.reverse()) socket.write(encodeJson(Op.FRAME, { cmd: p.cmd, nonce: p.nonce, data: p.cmd }));
  });
  expect(await Promise.all([client.request('FIRST'), client.request('SECOND')])).toEqual(['FIRST', 'SECOND']);
});
test('request timeout and close reject pending promises', async () => {
  const client = await fakePeer(() => {});
  await expect(client.request('NO_REPLY', {}, undefined, 15)).rejects.toThrow('RPC_TIMEOUT');
  const pending = client.request('DISCONNECT').catch((error: Error) => error);
  client.close();
  expect(String(await pending)).toContain('IPC_DISCONNECTED');
});
test('upstream error text is not leaked to logs or errors', async () => {
  const client = await fakePeer((frame, socket) => {
    const p = decodeObject(frame.payload);
    socket.write(encodeJson(Op.FRAME, { cmd: p.cmd, nonce: p.nonce, evt: 'ERROR', data: { code: 4006, message: 'SECRET_TOKEN' } }));
  });
  try { await client.request('AUTHENTICATE'); throw new Error('unexpected success'); }
  catch (error) { expect(String(error)).not.toContain('SECRET_TOKEN'); expect(String(error)).toContain('RPC_REJECTED'); }
});
test('two missed heartbeats close an otherwise idle connection', async () => {
  const client = await fakePeer(() => {}, false);
  expect((await client.whenClosed).code).toBe('RPC_HEARTBEAT_TIMEOUT');
});
test('official pipe candidates do not use a TCP port', () => {
  expect(ipcCandidates('win32')[0]).toBe('\\\\?\\pipe\\discord-ipc-0');
  expect(ipcCandidates('win32')).toHaveLength(10);
  expect(ipcCandidates('linux', { XDG_RUNTIME_DIR: '/run/user/example' })[0]).toBe('/run/user/example/discord-ipc-0');
});

test('JSON heartbeat keeps an interactive authorization alive across several intervals',async()=>{
 const client=await fakePeer((frame,socket)=>{
  const p=decodeObject(frame.payload);
  if(p.cmd==='AUTHORIZE')setTimeout(()=>socket.write(encodeJson(Op.FRAME,{cmd:p.cmd,nonce:p.nonce,data:{code:'SYNTHETIC_AUTH_CODE'}})),95);
 });
 expect(await client.request('AUTHORIZE',{},undefined,1000)).toEqual({code:'SYNTHETIC_AUTH_CODE'});
 expect(client.isClosed).toBe(false);
});
test('peer CLOSE preserves its numeric reason without retaining its private text',async()=>{
 const client=await fakePeer((_frame,socket)=>socket.write(encodeJson(Op.CLOSE,{code:4002,message:'PRIVATE_AUTH_RESPONSE'})));
 const error=await client.request('AUTHORIZE').catch(e=>e);
 expect(error).toBeInstanceOf(DiscordError);if(!(error instanceof DiscordError))throw new Error('EXPECTED_DISCORD_ERROR');
 expect(error.code).toBe('RPC_PEER_CLOSED');expect(error.rpcCode).toBe(4002);
 expect(JSON.stringify(error)).not.toContain('PRIVATE_AUTH_RESPONSE');
});

test('optional IPC tracing excludes authorization codes, tokens and peer error text',async()=>{
 const entries:unknown[]=[];
 const client=await fakePeer((frame,socket)=>{
  const p=decodeObject(frame.payload);
  socket.write(encodeJson(Op.FRAME,{cmd:p.cmd,nonce:p.nonce,data:{code:'PRIVATE_CODE',access_token:'PRIVATE_TOKEN'}}));
 },true,{diagnostic:entry=>entries.push(entry)});
 await client.request('AUTHORIZE',{client_id:'123',scopes:['rpc'],code:'PRIVATE_REQUEST'});
 await client.request('AUTHENTICATE',{access_token:'PRIVATE_TOKEN'});
 client.close();
 expect(JSON.stringify(entries)).not.toMatch(/PRIVATE|client_id|access_token|scopes/);
 expect(entries).toContainEqual(expect.objectContaining({event:'request',command:'AUTHORIZE'}));
});
