import {createHash} from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {Inflate,Zip,ZipPassThrough} from 'fflate';
import {ENVIRONMENT_LIMITS as limits} from './types.ts';

const hashPath=/^assets\/[a-f0-9]{64}$/;
const fail=(code='ARCHIVE_INVALID'):never=>{throw new Error(`ENVIRONMENT_${code}`);};
const pathAllowed=(path:string)=>path==='entaku.json'||hashPath.test(path);
const maximum=(path:string)=>path==='entaku.json'?limits.manifestBytes:limits.fileBytes;
const table=Uint32Array.from({length:256},(_,index)=>{
  let value=index;for(let bit=0;bit<8;bit++)value=value&1?(value>>>1)^0xedb88320:value>>>1;return value>>>0;
});
function crcChunk(crc:number,chunk:Uint8Array):number {
  for(const byte of chunk)crc=(crc>>>8)^table[(crc^byte)&255]!;
  return crc;
}
/** Hash large payloads without monopolising the server's voice/event loop. */
export async function environmentHash(bytes:Uint8Array):Promise<string> {
  const hash=createHash('sha256');
  for(let offset=0;offset<bytes.length;offset+=1024*1024){
    hash.update(bytes.subarray(offset,offset+1024*1024));
    if(offset+1024*1024<bytes.length)await yieldTurn();
  }
  return hash.digest('hex');
}

interface Member {name:string;size:number;originalSize:number;crc:number;compression:number;flags:number;offset:number;start:number;end:number}
/** ZIP32 is sufficient for the package limits. Names never become disk paths.
 * Check both directories before expanding anything, including local offsets and
 * data descriptors. Decoding each declared range also avoids treating PK bytes
 * inside a stored model/texture as a new ZIP member. */
async function directory(bytes:Uint8Array):Promise<Member[]> {
  if(bytes.byteLength>limits.archiveBytes)return fail('ARCHIVE_TOO_LARGE');
  if(bytes.byteLength<22)return fail();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=(at:number)=>view.getUint16(at,true),u32=(at:number)=>view.getUint32(at,true);
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
    if(u32(at)===0x06054b50&&at+22+u16(at+20)===bytes.length){end=at;break;}
  }
  if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))return fail();
  const count=u16(end+10),centralSize=u32(end+12),centralStart=u32(end+16);
  if(!count||count===65535||count>limits.files)return fail('FILE_LIMIT');
  if(centralStart+centralSize!==end)return fail();
  const names=new Set<string>(),members:Member[]=[];let at=centralStart,total=0;
  const extra=(start:number,length:number)=>{
    const stop=start+length;
    while(start<stop){if(start+4>stop)return fail();const id=u16(start),size=u16(start+2);if(id===1)return fail('ZIP64_UNSUPPORTED');start+=4+size;}
    if(start!==stop)return fail();
  };
  const nameAt=(start:number,length:number)=>{
    if(!length||length>71)return fail('PATH_REJECTED');
    let name='';for(const byte of bytes.subarray(start,start+length)){if(byte>127)return fail('PATH_REJECTED');name+=String.fromCharCode(byte);}
    if(!pathAllowed(name))return fail('PATH_REJECTED');return name;
  };
  for(let index=0;index<count;index++){
    if(at+46>end||u32(at)!==0x02014b50)return fail();
    const flags=u16(at+8),compression=u16(at+10),crc=u32(at+16),size=u32(at+20),originalSize=u32(at+24);
    const nameLength=u16(at+28),extraLength=u16(at+30),commentLength=u16(at+32),offset=u32(at+42),next=at+46+nameLength+extraLength+commentLength;
    const fileType=(u32(at+38)>>>16)&0xf000;
    if(next>end||u16(at+34)||flags&~0x080e||(compression!==0&&compression!==8)||(compression===0&&(flags&6))||(fileType!==0&&fileType!==0x8000))return fail();
    const name=nameAt(at+46,nameLength);extra(at+46+nameLength,extraLength);
    if(names.has(name))return fail('DUPLICATE_PATH');names.add(name);
    if(originalSize>maximum(name))return fail('FILE_TOO_LARGE');
    total+=originalSize;if(total>limits.unpackedBytes)return fail('ARCHIVE_TOO_LARGE');
    if(size===0xffffffff||offset===0xffffffff||size>limits.archiveBytes||offset+30>centralStart)return fail();
    if(compression===0&&size!==originalSize)return fail();
    members.push({name,size,originalSize,crc,compression,flags,offset,start:0,end:0});at=next;
    if(index%256===255)await yieldTurn();
  }
  if(at!==end||!names.has('entaku.json'))return fail('MANIFEST_MISSING');
  members.sort((a,b)=>a.offset-b.offset);let local=0;
  for(const member of members){
    const {offset,size,flags,compression,crc,originalSize}=member;
    if(offset!==local||u32(offset)!==0x04034b50||u16(offset+6)!==flags||u16(offset+8)!==compression)return fail();
    const nameLength=u16(offset+26),extraLength=u16(offset+28),start=offset+30+nameLength+extraLength;
    if(start+size>centralStart||nameAt(offset+30,nameLength)!==member.name)return fail();
    extra(offset+30+nameLength,extraLength);
    const localCrc=u32(offset+14),localSize=u32(offset+18),localOriginal=u32(offset+22);
    let finish=start+size;
    if(flags&8){
      if((localCrc!==0&&localCrc!==crc)||(localSize!==0&&localSize!==size)||(localOriginal!==0&&localOriginal!==originalSize))return fail();
      const matches=(at:number)=>at+12<=centralStart&&u32(at)===crc&&u32(at+4)===size&&u32(at+8)===originalSize;
      if(finish+16<=centralStart&&u32(finish)===0x08074b50&&matches(finish+4))finish+=16;
      else if(matches(finish))finish+=12;else return fail();
    }else if(localCrc!==crc||localSize!==size||localOriginal!==originalSize)return fail();
    member.start=start;member.end=finish;local=finish;
  }
  if(local!==centralStart)return fail();return members;
}

/** Bounded actual output, rather than trusting the ZIP's declared sizes. */
export async function unpackEnvironmentArchive(bytes:Uint8Array):Promise<Map<string,Uint8Array>> {
  try{
    const members=await directory(bytes),files=new Map<string,Uint8Array>();let total=0,budget=0,turn=performance.now();
    for(const member of members){
      const output=new Uint8Array(member.originalSize);let offset=0,crc=0xffffffff,complete=false;
      const consume=(chunk:Uint8Array,final:boolean)=>{
        if(offset+chunk.length>member.originalSize||offset+chunk.length>maximum(member.name)||total+chunk.length>limits.unpackedBytes)return fail('EXPANSION_LIMIT');
        output.set(chunk,offset);offset+=chunk.length;total+=chunk.length;budget+=chunk.length;crc=crcChunk(crc,chunk);if(final)complete=true;
      };
      const inflate=member.compression===8?new Inflate(consume):null;
      const chunkSize=inflate?4096:64*1024;
      for(let offset=0;offset<member.size;offset+=chunkSize){
        const chunk=bytes.subarray(member.start+offset,member.start+Math.min(member.size,offset+chunkSize)),final=offset+chunkSize>=member.size;
        if(inflate)inflate.push(chunk,final);else consume(chunk,final);
        if(budget>=256*1024||performance.now()-turn>=8){await yieldTurn();budget=0;turn=performance.now();}
      }
      if(member.size===0){if(inflate)inflate.push(new Uint8Array(),true);else consume(new Uint8Array(),true);}
      if(!complete||offset!==member.originalSize||(crc^0xffffffff)>>>0!==member.crc)return fail('ARCHIVE_CORRUPT');
      files.set(member.name,output);
    }
    return files;
  }catch(error){throw error instanceof Error&&error.message.startsWith('ENVIRONMENT_')?error:new Error('ENVIRONMENT_ARCHIVE_INVALID');}
}

/** Models and images are already compact. Stored ZIP members keep export work
 * bounded and preserve every source byte; only the final archive is allocated. */
export async function packEnvironmentArchive(files:ReadonlyMap<string,Uint8Array>):Promise<Uint8Array> {
  if(!files.has('entaku.json'))return fail('MANIFEST_MISSING');
  if(files.size>limits.files)return fail('FILE_LIMIT');
  let total=0,estimated=22;
  for(const [name,bytes] of files){
    if(!pathAllowed(name))return fail('PATH_REJECTED');
    if(!(bytes instanceof Uint8Array)||bytes.length>maximum(name))return fail('FILE_TOO_LARGE');
    total+=bytes.length;estimated+=bytes.length+92+name.length*2;
  }
  if(total>limits.unpackedBytes||estimated>limits.archiveBytes)return fail('ARCHIVE_TOO_LARGE');
  const chunks:Uint8Array[]=[];let size=0,finished=false,failure:Error|null=null,budget=0,turn=performance.now();
  const archive=new Zip((error,chunk,final)=>{
    if(error){failure=error;return;}size+=chunk.length;
    if(size>limits.archiveBytes){failure=new Error('ENVIRONMENT_ARCHIVE_TOO_LARGE');return;}
    chunks.push(chunk);if(final)finished=true;
  });
  try{
    for(const [name,bytes] of files){
      const file=new ZipPassThrough(name);file.mtime=new Date(1980,0,1);archive.add(file);
      for(let offset=0;offset<bytes.length;offset+=64*1024){
        const chunk=bytes.subarray(offset,offset+64*1024);file.push(chunk,offset+64*1024>=bytes.length);budget+=chunk.length;
        if(failure)throw failure;
        if(budget>=256*1024||performance.now()-turn>=8){await yieldTurn();budget=0;turn=performance.now();}
      }
      if(!bytes.length)file.push(bytes,true);
    }
    archive.end();if(failure)throw failure;if(!finished)return fail();
    const output=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;budget+=chunk.length;if(budget>=1024*1024){await yieldTurn();budget=0;}}
    return output;
  }catch(error){archive.terminate();throw error instanceof Error&&error.message.startsWith('ENVIRONMENT_')?error:new Error('ENVIRONMENT_ARCHIVE_INVALID');}
}
