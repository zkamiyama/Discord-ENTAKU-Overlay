export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 4096;
export interface ImageInfo { width: number; height: number; mime: 'image/png' | 'image/webp' }
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function dimensions(width: number, height: number, mime: ImageInfo['mime']): ImageInfo {
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) throw new Error('IMAGE_DIMENSIONS_REJECTED');
  return { width, height, mime };
}
/** Check container structure without invoking a native image codec in the server. */
export function inspectImage(input: Uint8Array): ImageInfo {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8, info: ImageInfo | undefined, ended = false, data = false, chunks = 0;
    while (offset < b.length) {
      if (++chunks > 4096 || offset + 12 > b.length) throw new Error('INVALID_IMAGE');
      const size = b.readUInt32BE(offset), end = offset + 12 + size;
      if (end > b.length) throw new Error('INVALID_IMAGE');
      const type = b.toString('ascii', offset + 4, offset + 8);
      if (crc32(b.subarray(offset + 4, end - 4)) !== b.readUInt32BE(end - 4)) throw new Error('INVALID_IMAGE');
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('ANIMATED_IMAGE_REJECTED');
      if (!info && type !== 'IHDR') throw new Error('INVALID_IMAGE');
      if (type === 'IHDR') {
        if (info || size !== 13) throw new Error('INVALID_IMAGE');
        const depth = b[offset + 16]!, color = b[offset + 17]!;
        const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!depths[color]?.includes(depth) || b[offset + 18] !== 0 || b[offset + 19] !== 0 || b[offset + 20]! > 1) throw new Error('INVALID_IMAGE');
        info = dimensions(b.readUInt32BE(offset + 8), b.readUInt32BE(offset + 12), 'image/png');
      }
      if (type === 'IDAT' && size > 0) data = true;
      if (type === 'IEND') { if (size !== 0 || end !== b.length) throw new Error('INVALID_IMAGE'); ended = true; }
      offset = end;
    }
    if (!info || !data || !ended) throw new Error('INVALID_IMAGE');
    return info;
  }
  if (b.length >= 20 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    if (b.readUInt32LE(4) + 8 !== b.length) throw new Error('INVALID_IMAGE');
    let offset = 12, info: ImageInfo | undefined, canvas: ImageInfo | undefined, chunks = 0;
    while (offset < b.length) {
      if (++chunks > 1024 || offset + 8 > b.length) throw new Error('INVALID_IMAGE');
      const type = b.toString('ascii', offset, offset + 4), size = b.readUInt32LE(offset + 4), p = offset + 8;
      const end = p + size + (size & 1); if (end > b.length) throw new Error('INVALID_IMAGE');
      if (type === 'ANIM' || type === 'ANMF') throw new Error('ANIMATED_IMAGE_REJECTED');
      if (type === 'VP8X') {
        if (offset !== 12 || size !== 10 || canvas || (b[p]! & 0xc1) !== 0) throw new Error('INVALID_IMAGE');
        if (b[p]! & 2) throw new Error('ANIMATED_IMAGE_REJECTED');
        canvas = dimensions(1 + b.readUIntLE(p + 4, 3), 1 + b.readUIntLE(p + 7, 3), 'image/webp');
      } else if (type === 'VP8L') {
        if (info || size < 5 || b[p] !== 0x2f || (b[p + 4]! & 0xe0)) throw new Error('INVALID_IMAGE');
        const packed = b.readUInt32LE(p + 1);
        info = dimensions(1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff), 'image/webp');
      } else if (type === 'VP8 ') {
        if (info || size < 10 || (b[p]! & 1) || b.toString('hex', p + 3, p + 6) !== '9d012a') throw new Error('INVALID_IMAGE');
        info = dimensions(b.readUInt16LE(p + 6) & 0x3fff, b.readUInt16LE(p + 8) & 0x3fff, 'image/webp');
      }
      offset = end;
    }
    if (!info || (canvas && (canvas.width !== info.width || canvas.height !== info.height))) throw new Error('INVALID_IMAGE');
    return info;
  }
  throw new Error('IMAGE_FORMAT_REJECTED');
}
