import {Unzip,UnzipInflate} from 'fflate';
import {MAX_STUDIO_ARCHIVE_BYTES,MAX_GLB_BYTES,MAX_STUDIO_UNPACKED_BYTES,safeStudioPath} from './manifest.ts';
import type {StudioFile} from './store.ts';
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
