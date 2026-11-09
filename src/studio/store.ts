import {writeAtomicJson} from '../storage/atomic-json.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { inspectGltfEntry } from './gltf.ts';
import { DEFAULT_STUDIO_SCENE, MAX_GLB_BYTES, MAX_STUDIO_ARCHIVE_BYTES, MAX_STUDIO_UNPACKED_BYTES, safeStudioPath, validateStudioScene, type StudioScene } from './manifest.ts';
export interface StudioFile { path: string; bytes: Uint8Array }
export interface BundleFile { path: string; hash: string; byteLength: number; mime: string }
export interface StudioBundle { schemaVersion: 1; bundleId: string; entry: string; files: BundleFile[]; byteLength: number }
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const validId = (value: string) => /^[a-f0-9]{64}$/.test(value);
const mime = (path: string) => ({ png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',ktx2:'image/ktx2',gltf:'model/gltf+json',glb:'model/gltf-binary' }[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream');
async function bounded(path: string, maximum: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum) throw new Error('STUDIO_FILE_REJECTED');
  const bytes = await readFile(path);
  if (bytes.byteLength !== info.size || bytes.byteLength > maximum) throw new Error('STUDIO_FILE_REJECTED');
  return bytes;
}
/** ZIP members never become filesystem paths. Streaming inflate enforces actual output limits. */
export function unpackStudioZip(bytes: Uint8Array): StudioFile[] {
  if (bytes.byteLength > MAX_STUDIO_ARCHIVE_BYTES) throw new Error('STUDIO_ARCHIVE_TOO_LARGE');
  const files: StudioFile[] = []; const names = new Set<string>(); let total = 0, pending = 0;
  let failure: Error | null = null;
  const archive = new Unzip(file => {
    if (file.name.endsWith('/')) return;
    const path = safeStudioPath(file.name);
    if (names.has(path) || names.size >= 256) throw new Error('STUDIO_FILE_LIMIT');
    names.add(path);
    if (file.originalSize !== undefined && file.originalSize > MAX_GLB_BYTES) throw new Error('STUDIO_FILE_TOO_LARGE');
    const chunks: Uint8Array[] = []; let size = 0; pending++;
    file.ondata = (error, chunk, final) => {
      if (failure) { file.terminate(); return; }
      if (error) { failure = new Error('STUDIO_ARCHIVE_INVALID'); return; }
      size += chunk.byteLength; total += chunk.byteLength;
      if (size > MAX_GLB_BYTES || total > MAX_STUDIO_UNPACKED_BYTES) {
        failure = new Error('STUDIO_ARCHIVE_TOO_LARGE'); file.terminate(); return;
      }
      chunks.push(chunk);
      if (final) {
        const output = new Uint8Array(size); let offset = 0;
        for (const c of chunks) { output.set(c,offset); offset += c.byteLength; }
        files.push({path,bytes:output}); pending--;
      }
    };
    file.start();
  });
  archive.register(UnzipInflate);
  try { for(let offset=0;offset<bytes.length;offset+=4096){archive.push(bytes.subarray(offset,offset+4096),offset+4096>=bytes.length);if(failure)throw failure;} } catch (e) { throw e instanceof Error && e.message.startsWith('STUDIO_') ? e : new Error('STUDIO_ARCHIVE_INVALID'); }
  if (failure) throw failure;
  if (pending || !files.length) throw new Error('STUDIO_ARCHIVE_INVALID');
  return files;
}
export function selectStudioEntry(files: readonly StudioFile[], requested?: string): string {
  if (requested) return safeStudioPath(requested);
  const entries = files.filter(f=>/\.(glb|gltf)$/i.test(f.path));
  if (entries.length !== 1) throw new Error('STUDIO_ENTRY_REQUIRED');
  return entries[0]!.path;
}
/** Immutable bundles; only scene.json is editable. null is a test/safe-mode memory store. */
export class StudioStore {
  private scene: StudioScene = structuredClone(DEFAULT_STUDIO_SCENE);
  private bundles = new Map<string,StudioBundle>();
  private data = new Map<string,Uint8Array>();
  constructor(private directory: string | null = null) {}
  async initialize(): Promise<StudioScene> {
    if (this.directory) {
      await mkdir(join(this.directory,'assets','studios'),{recursive:true,mode:0o700});
      try { this.scene = validateStudioScene(JSON.parse((await bounded(join(this.directory,'scene.json'),1024*1024)).toString('utf8'))); }
      catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('STUDIO_SETTINGS_READ_FAILED'); }
    }
    return this.snapshot();
  }
  snapshot(): StudioScene { return structuredClone(this.scene); }
  async importFiles(input: readonly StudioFile[], requested?: string): Promise<StudioBundle> {
    if (!input.length || input.length > 256) throw new Error('STUDIO_FILE_LIMIT');
    const files = new Map<string,Uint8Array>(); let total=0;
    for (const f of input) {
      const path=safeStudioPath(f.path);
      if (files.has(path)) throw new Error('STUDIO_DUPLICATE_PATH');
      if (f.bytes.byteLength > MAX_GLB_BYTES) throw new Error('STUDIO_FILE_TOO_LARGE');
      total += f.bytes.byteLength;
      if (total > MAX_STUDIO_UNPACKED_BYTES) throw new Error('STUDIO_ARCHIVE_TOO_LARGE');
      files.set(path,f.bytes);
    }
    const entry=selectStudioEntry([...files].map(([path,bytes])=>({path,bytes})),requested);
    const source=files.get(entry); if (!source) throw new Error('STUDIO_ENTRY_NOT_FOUND');
    // Only inspect resource references. GLTFLoader remains responsible for model interpretation.
    const document=inspectGltfEntry(source,entry);
    for (const path of document.externalPaths) if (!files.has(path)) throw new Error('STUDIO_DEPENDENCY_MISSING');
    const metadata=[...files].map(([path,bytes])=>({path,hash:hash(bytes),byteLength:bytes.byteLength,mime:mime(path)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const bundleId=hash(JSON.stringify({entry,files:metadata}));
    const bundle: StudioBundle={schemaVersion:1,bundleId,entry,files:metadata,byteLength:total};
    const existing=await this.list();
    if (!existing.some(b=>b.bundleId===bundleId) && (existing.length>=32 || existing.reduce((s,b)=>s+b.byteLength,0)+total>512*1024*1024)) throw new Error('STUDIO_STORE_FULL');
    if (this.directory) {
      const root=join(this.directory,'assets','studios'),temporary=join(root,'.pending-'+randomUUID());
      const target=join(root,bundleId);
      if (!existing.some(b=>b.bundleId===bundleId)) {
        await mkdir(temporary,{recursive:true,mode:0o700});
        try {
          for (const f of metadata) await writeFile(join(temporary,f.hash),files.get(f.path)!,{mode:0o600});
          await writeFile(join(temporary,'bundle.json'),JSON.stringify(bundle),{flag:'wx',mode:0o600});
          await rename(temporary,target);
        } finally { await rm(temporary,{recursive:true,force:true}); }
      }
    } else for (const f of metadata) this.data.set(`${bundleId}/${f.hash}`,files.get(f.path)!.slice());
    this.bundles.set(bundleId,bundle); return structuredClone(bundle);
  }
  async list(): Promise<StudioBundle[]> {
    if (this.directory) {
      const root=join(this.directory,'assets','studios'); await mkdir(root,{recursive:true,mode:0o700});
      const names=(await readdir(root)).filter(validId);
      if(names.length>32)throw new Error('STUDIO_STORE_FULL');
      for (const name of names) await this.bundle(name);
    }
    return structuredClone([...this.bundles.values()]);
  }
  async bundle(id: string): Promise<StudioBundle> {
    if (!validId(id)) throw new Error('STUDIO_BUNDLE_NOT_FOUND');
    const cached=this.bundles.get(id); if(cached)return structuredClone(cached);
    if (!this.directory) throw new Error('STUDIO_BUNDLE_NOT_FOUND');
    try {
      const b: StudioBundle=JSON.parse((await bounded(join(this.directory,'assets','studios',id,'bundle.json'),1024*1024)).toString('utf8'));
      if (b.schemaVersion!==1 || b.bundleId!==id || !Array.isArray(b.files) || !b.files.length || b.files.length>256) throw new Error();
      if(b.files.some(f=>safeStudioPath(f.path)!==f.path||!validId(f.hash)||!Number.isSafeInteger(f.byteLength)||f.byteLength<0||f.byteLength>MAX_GLB_BYTES||f.mime!==mime(f.path)))throw new Error();
      if(new Set(b.files.map(f=>f.path)).size!==b.files.length||!b.files.some(f=>f.path===b.entry)||b.byteLength!==b.files.reduce((s,f)=>s+f.byteLength,0)||b.byteLength>MAX_STUDIO_UNPACKED_BYTES)throw new Error();
      if(hash(JSON.stringify({entry:b.entry,files:b.files}))!==id)throw new Error();
      this.bundles.set(id,b); return structuredClone(b);
    } catch { throw new Error('STUDIO_BUNDLE_NOT_FOUND'); }
  }
  async file(id: string, path: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const b=await this.bundle(id),f=b.files.find(f=>f.path===path);
    if (!f) throw new Error('STUDIO_FILE_NOT_FOUND');
    const bytes=this.directory ? await bounded(join(this.directory,'assets','studios',id,f.hash),MAX_GLB_BYTES) : this.data.get(`${id}/${f.hash}`);
    if (!bytes || bytes.byteLength!==f.byteLength || hash(bytes)!==f.hash) throw new Error('STUDIO_FILE_CORRUPT');
    return {bytes:bytes.slice(),mime:f.mime};
  }
  async validateDraft(input: unknown): Promise<StudioScene> {
    const scene=validateStudioScene(input);
    for (const o of scene.objects) if(o.kind==='model')await this.bundle(o.bundleId);
    return scene;
  }
  private async persistScene(clean: StudioScene): Promise<void> {
    if(this.directory)await writeAtomicJson(join(this.directory,'scene.json'),clean,'STUDIO_SETTINGS_WRITE_FAILED',true);
  }
  /** Compensating restore preserves the old revision instead of creating a new edit. */
  async restore(input: StudioScene): Promise<void> {
    const clean=validateStudioScene(input);await this.persistScene(clean);this.scene=clean;
  }
  async save(input: unknown): Promise<StudioScene> {
    const clean=await this.validateDraft(input);
    clean.revision=this.scene.revision+1;
    await this.persistScene(clean);
    this.scene=clean; return this.snapshot();
  }
}
