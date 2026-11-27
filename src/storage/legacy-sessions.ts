import {lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validateSession} from '../domain/seat-allocator.ts';
import type {SeatSession} from '../contracts/domain.ts';
import type {SessionSource} from './settings-store.ts';

export interface LegacySession {source:SessionSource;session:SeatSession}
const MAX_SESSION_BYTES=1024*1024;

async function readSession(path:string):Promise<SeatSession>{
 const info=await lstat(path);
 if(!info.isFile()||info.size>MAX_SESSION_BYTES)throw new Error('SESSION_READ_FAILED');
 const handle=await open(path,'r');
 try{
  // A file that grows after stat must not make migration allocate its full size.
  const bytes=Buffer.alloc(info.size+1);let length=0;
  while(length<bytes.length){
   const read=await handle.read(bytes,length,bytes.length-length,null);
   if(!read.bytesRead)break;
   length+=read.bytesRead;
  }
  if(length!==info.size)throw new Error('SESSION_READ_FAILED');
  return validateSession(JSON.parse(bytes.subarray(0,length).toString('utf8')));
 }finally{await handle.close();}
}

/** One-time read-only import. Existing JSON and backups remain untouched; a
 * malformed source aborts the entire database migration instead of losing it. */
export async function readLegacySessions(directory:string):Promise<LegacySession[]>{
 const result:LegacySession[]=[];
 for(const source of ['demo','ipc'] as const){
  const root=join(directory,'sessions',source);let names:string[];
  try{names=(await readdir(root)).filter(name=>/^\d{1,20}\.json$/.test(name)).sort();}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw new Error('SESSION_READ_FAILED');}
  if(names.length>1024)throw new Error('TOO_MANY_SESSIONS');
  for(const name of names){
   try{
    const session=await readSession(join(root,name));
    if(`${session.channelId}.json`!==name)throw new Error('SESSION_READ_FAILED');
    result.push({source,session});
   }catch{throw new Error('SESSION_READ_FAILED');}
  }
 }
 return result;
}
