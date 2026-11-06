import { deflateSync } from 'node:zlib';
export function pngChunk(name: string, data: Uint8Array): Buffer {
  const payload = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
  for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}
export function png(width = 64, height = 128, animated = false): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((1 + width * 4) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + width * 4) + 1 + x * 4;
    raw[i] = 230; raw[i + 1] = 160; raw[i + 2] = 100;
    // Synthetic asymmetric mask with an internal hole: not an avatar artwork asset.
    raw[i + 3] = x > width * .1 && x < width * .85 && y > height * .06 && !(x > width * .35 && x < width * .55 && y > height * .5 && y < height * .65) ? 255 : 0;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), ...(animated ? [pngChunk('acTL', Buffer.alloc(8))] : []), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
