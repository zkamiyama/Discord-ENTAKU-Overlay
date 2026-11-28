import {expect,test} from 'bun:test';
import {Zip,ZipPassThrough,zipSync} from 'fflate';
import {packEnvironmentArchive,unpackEnvironmentArchive} from '../../src/environment/archive.ts';
import {ENVIRONMENT_LIMITS} from '../../src/environment/types.ts';

const name=`assets/${'a'.repeat(64)}`,json=Buffer.from('{}');
function zipEntries(entries:Array<[string,Uint8Array]>):Uint8Array {
  const chunks:Uint8Array[]=[];const zip=new Zip((error,data)=>{if(error)throw error;chunks.push(data);});
  for(const [name,bytes] of entries){const file=new ZipPassThrough(name);zip.add(file);file.push(bytes,true);}zip.end();return Buffer.concat(chunks);
}
function central(bytes:Uint8Array):number[] {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=view.getUint32(bytes.length-6,true);const result:number[]=[];
  while(at+46<=bytes.length&&view.getUint32(at,true)===0x02014b50){result.push(at);at+=46+view.getUint16(at+28,true)+view.getUint16(at+30,true)+view.getUint16(at+32,true);}return result;
}
test('stored environment archive preserves zero bytes and embedded ZIP signatures without guessing member boundaries',async()=>{
  const nested=zipEntries([['entaku.json',json],[name,Buffer.from('PK\x07\x08 PK\x03\x04 PK\x01\x02')]]);
  const empty=`assets/${'b'.repeat(64)}`,files=new Map<string,Uint8Array>([['entaku.json',json],[name,nested],[empty,new Uint8Array()]]);
  const bytes=await packEnvironmentArchive(files),restored=await unpackEnvironmentArchive(bytes);
  for(const [path,data] of files)expect(restored.get(path)).toEqual(new Uint8Array(data));expect(restored.size).toBe(3);
});
test('deflated ZIPs are accepted but truncation, duplicate paths, alien paths and local/central disagreement are rejected',async()=>{
  const bytes=zipSync({'entaku.json':json,[name]:Buffer.alloc(20000,7)});
  expect((await unpackEnvironmentArchive(bytes)).get(name)).toEqual(new Uint8Array(20000).fill(7));
  await expect(unpackEnvironmentArchive(bytes.subarray(0,bytes.length-1))).rejects.toThrow('ENVIRONMENT_ARCHIVE_INVALID');
  await expect(unpackEnvironmentArchive(zipEntries([['entaku.json',json],[name,json],[name,json]]))).rejects.toThrow('ENVIRONMENT_DUPLICATE_PATH');
  for(const path of ['../entaku.json','assets/../escape','assets/','readme.txt',`assets/${'A'.repeat(64)}`]){
    await expect(unpackEnvironmentArchive(zipSync({'entaku.json':json,[path]:json}))).rejects.toThrow('ENVIRONMENT_PATH_REJECTED');
  }
  const mismatch=Buffer.from(bytes),view=new DataView(mismatch.buffer,mismatch.byteOffset,mismatch.byteLength),entry=central(mismatch)[1]!,local=view.getUint32(entry+42,true);
  mismatch[local+30+7]='b'.charCodeAt(0);
  await expect(unpackEnvironmentArchive(mismatch)).rejects.toThrow('ENVIRONMENT_ARCHIVE_INVALID');
});
test('header limits and actual inflate output are bounded before any live asset is touched',async()=>{
  const huge=Buffer.from(zipSync({'entaku.json':json})),view=new DataView(huge.buffer,huge.byteOffset,huge.byteLength);
  view.setUint32(22,ENVIRONMENT_LIMITS.manifestBytes+1,true);view.setUint32(central(huge)[0]!+24,ENVIRONMENT_LIMITS.manifestBytes+1,true);
  await expect(unpackEnvironmentArchive(huge)).rejects.toThrow('ENVIRONMENT_FILE_TOO_LARGE');
  const bomb=Buffer.from(zipSync({'entaku.json':json,[name]:Buffer.alloc(1024*1024)},{level:9})),bombView=new DataView(bomb.buffer,bomb.byteOffset,bomb.byteLength),entry=central(bomb)[1]!,local=bombView.getUint32(entry+42,true);
  bombView.setUint32(local+22,1,true);bombView.setUint32(entry+24,1,true);
  await expect(unpackEnvironmentArchive(bomb)).rejects.toThrow('ENVIRONMENT_EXPANSION_LIMIT');
  const tooMany=zipSync(Object.fromEntries([['entaku.json',json],...Array.from({length:ENVIRONMENT_LIMITS.files},(_,i)=>[`assets/${i.toString(16).padStart(64,'0')}`,new Uint8Array()])]));
  await expect(unpackEnvironmentArchive(tooMany)).rejects.toThrow('ENVIRONMENT_FILE_LIMIT');
});
test('CRC, encrypted flags and forged local offsets are checked even when sizes and names agree',async()=>{
  const bytes=zipSync({'entaku.json':json,[name]:Buffer.from('content')},{level:0});
  const badCrc=Buffer.from(bytes),crcView=new DataView(badCrc.buffer,badCrc.byteOffset,badCrc.byteLength),entry=central(badCrc)[1]!,local=crcView.getUint32(entry+42,true);
  crcView.setUint32(entry+16,12345,true);crcView.setUint32(local+14,12345,true);
  await expect(unpackEnvironmentArchive(badCrc)).rejects.toThrow('ENVIRONMENT_ARCHIVE_CORRUPT');
  const encrypted=Buffer.from(bytes),flagView=new DataView(encrypted.buffer,encrypted.byteOffset,encrypted.byteLength);flagView.setUint16(entry+8,1,true);flagView.setUint16(local+6,1,true);
  await expect(unpackEnvironmentArchive(encrypted)).rejects.toThrow('ENVIRONMENT_ARCHIVE_INVALID');
  const offset=Buffer.from(bytes);new DataView(offset.buffer,offset.byteOffset,offset.byteLength).setUint32(entry+42,1,true);
  await expect(unpackEnvironmentArchive(offset)).rejects.toThrow('ENVIRONMENT_ARCHIVE_INVALID');
});
test('large stored export and import yield to other server work',async()=>{
  const files=new Map([['entaku.json',json],[name,new Uint8Array(4*1024*1024).fill(42)]]);
  let exportedTick=false;setImmediate(()=>{exportedTick=true;});const bytes=await packEnvironmentArchive(files);expect(exportedTick).toBe(true);
  let importedTick=false;setImmediate(()=>{importedTick=true;});const restored=await unpackEnvironmentArchive(bytes);expect(importedTick).toBe(true);expect(restored.get(name)?.length).toBe(4*1024*1024);
});
