export class AvatarCache {
  private cache = new Map<string, Uint8Array>();
  private inflight = new Map<string, Promise<Uint8Array>>();
  async get(url: string): Promise<Uint8Array> {
    if (!/^https:\/\/cdn\.discordapp\.com\/avatars\/\d{1,20}\/[a-zA-Z0-9_]{1,128}\.png\?size=256$/.test(url)) throw new Error('AVATAR_URL_REJECTED');
    const cached = this.cache.get(url); if (cached) return cached;
    const pending = this.inflight.get(url); if (pending) return pending;
    if (this.inflight.size >= 32) throw new Error('AVATAR_BUSY');
    const load = this.load(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, load); return load;
  }
  private async load(url: string): Promise<Uint8Array> {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body) throw new Error('AVATAR_FETCH_FAILED');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('AVATAR_TOO_LARGE'); } chunks.push(next.value); }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('INVALID_AVATAR_IMAGE');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(width<1||height<1||width>1024||height>1024)throw new Error('INVALID_AVATAR_DIMENSIONS');
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(url, bytes); return bytes;
  }
}
