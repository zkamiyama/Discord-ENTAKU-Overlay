import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '../../src/domain/session-store.ts';
import { newSession } from '../../src/domain/seat-allocator.ts';
test('session save is reloadable, backs up previous version and fails on corruption', async () => {
  const dir=await mkdtemp(join(tmpdir(),'entaku-store-'));
  try {
    const store=new SessionStore(dir),s=newSession('200','first');
    await store.save(s);expect(await store.loadAll()).toEqual([s]);
    await store.save({...s,revision:1});expect(JSON.parse(await readFile(join(dir,'200.json.bak'),'utf8')).revision).toBe(0);
    await writeFile(join(dir,'200.json'),'{broken');
    await expect(store.loadAll()).rejects.toThrow('SESSION_READ_FAILED');
    expect(await readFile(join(dir,'200.json'),'utf8')).toBe('{broken');
  } finally {await rm(dir,{recursive:true,force:true});}
});
