import {expect,test} from 'bun:test';
import {gunzipSync,gzipSync,zstdCompressSync} from 'node:zlib';
import {inspectGaussianSource,inspectGaussianSourceAsync} from '../../src/assets/gaussian-format.ts';
import {GaussianStore} from '../../src/assets/gaussian-store.ts';
import {GAUSSIAN_LIMITS} from '../../src/assets/gaussian-profile.ts';
import {gaussianFixture,gaussianPly,gaussianSpz} from '../helpers/gaussian.ts';

const fields=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
const row='0.1 0.2 0.3 0 0 0 1 -2 -2 -2 1 0 0 0';
function ascii(count:number,body=Array.from({length:count},()=>row).join('\r\n')){
  return Buffer.from(`ply\nformat ascii 1.0\nelement vertex ${count}\n${fields.map(name=>`property float ${name}`).join('\n')}\nend_header\n${body}`);
}
async function heartbeats<T>(work:()=>Promise<T>):Promise<{value:T;ticks:number}>{
  let running=true,ticks=0;
  const beat=()=>{if(running){ticks++;setImmediate(beat);}};
  setImmediate(beat);
  try{return {value:await work(),ticks};}finally{running=false;}
}

test('cooperative binary PLY inspection checks the last point and preserves exact bounds',async()=>{
  const count=8193,bytes=Buffer.from(gaussianPly(0,count)),start=bytes.indexOf('end_header\n')+11;
  bytes.writeFloatLE(123,start+(count-1)*68);bytes.writeFloatLE(-7,start+(count-1)*68+4);
  const expected=inspectGaussianSource(bytes,'source.ply');
  const {value,ticks}=await heartbeats(()=>inspectGaussianSourceAsync(bytes,'source.ply'));
  expect(value).toEqual(expected);expect(value.bounds!.max[0]).toBe(123);expect(value.bounds!.min[1]).toBe(-7);
  // Multiple turns during the scan, rather than one defer before a long block.
  expect(ticks).toBeGreaterThanOrEqual(4);
});

test('ASCII rows and all supported SPZ versions have the same synchronous and asynchronous results',async()=>{
  const text=ascii(4097,`\n \t\n${Array.from({length:4097},()=>row).join('\r\n')}\n \t\n`);
  const inputs=[{bytes:text,path:'source.ply'},...[1,2,3,4].map(version=>({bytes:gaussianSpz(version as 1|2|3|4,4097),path:'source.spz'}))];
  for(const {bytes,path} of inputs){
    const expected=inspectGaussianSource(bytes,path),{value,ticks}=await heartbeats(()=>inspectGaussianSourceAsync(bytes,path));
    expect(value).toEqual(expected);expect(ticks).toBeGreaterThanOrEqual(2);
  }
});

test('asynchronous inspection preserves format, length, numeric and decompression rejection codes',async()=>{
  const good=Buffer.from(gaussianPly(0,2049)),start=good.indexOf('end_header\n')+11,last=start+2048*68;
  const notFinite=Buffer.from(good);notFinite.writeFloatLE(Infinity,last);
  const scale=Buffer.from(good);scale.writeFloatLE(31,last+10*4);
  const rotation=Buffer.from(good);for(let index=13;index<17;index++)rotation.writeFloatLE(0,last+index*4);
  const spzVersion=Buffer.from(gunzipSync(gaussianSpz(3)));spzVersion.writeUInt32LE(5,4);
  const spzFlags=Buffer.from(gunzipSync(gaussianSpz(3)));spzFlags[14]=2;
  const spzCount=Buffer.from(gunzipSync(gaussianSpz(3)));spzCount.writeUInt32LE(1_000_001,8);
  const spzPoint=Buffer.from(gunzipSync(gaussianSpz(1,2049)));spzPoint.writeUInt16LE(0x7c00,16+2048*6);
  const toc=Buffer.from(gaussianSpz(4));toc.writeBigUInt64LE(2n**62n,32);
  const header=Buffer.from(gaussianSpz(4)),oversized=zstdCompressSync(Buffer.alloc(1_000_000));header.writeBigUInt64LE(BigInt(oversized.length),32);
  const cases:Array<{bytes:Uint8Array;path:string;code:string}>=[
    {bytes:new Uint8Array(GAUSSIAN_LIMITS.fileBytes+1),path:'source.ply',code:'GAUSSIAN_FILE_TOO_LARGE'},
    {bytes:good,path:'source.splat',code:'GAUSSIAN_FORMAT_UNSUPPORTED'},
    {bytes:Buffer.from('ply\n'),path:'source.ply',code:'GAUSSIAN_PLY_HEADER_INVALID'},
    {bytes:Buffer.from('ply\nformat binary_big_endian 1.0\nelement vertex 1\nend_header\n'),path:'source.ply',code:'GAUSSIAN_PLY_FORMAT_UNSUPPORTED'},
    {bytes:good.subarray(0,good.length-1),path:'source.ply',code:'GAUSSIAN_PLY_DATA_INVALID'},
    {bytes:notFinite,path:'source.ply',code:'GAUSSIAN_PLY_DATA_INVALID'},
    {bytes:scale,path:'source.ply',code:'GAUSSIAN_PLY_DATA_INVALID'},
    {bytes:rotation,path:'source.ply',code:'GAUSSIAN_PLY_DATA_INVALID'},
    {bytes:ascii(2,`${row}\n\n${row}`),path:'source.ply',code:'GAUSSIAN_PLY_DATA_INVALID'},
    {bytes:gzipSync(spzVersion),path:'source.spz',code:'GAUSSIAN_SPZ_VERSION_UNSUPPORTED'},
    {bytes:gzipSync(spzFlags),path:'source.spz',code:'GAUSSIAN_SPZ_EXTENSION_UNSUPPORTED'},
    {bytes:gzipSync(spzCount),path:'source.spz',code:'GAUSSIAN_SPLAT_LIMIT'},
    {bytes:gzipSync(spzPoint),path:'source.spz',code:'GAUSSIAN_SPZ_INVALID'},
    {bytes:gaussianSpz(3).subarray(0,8),path:'source.spz',code:'GAUSSIAN_SPZ_INVALID'},
    {bytes:toc,path:'source.spz',code:'GAUSSIAN_SPZ_INVALID'},
    {bytes:Buffer.concat([header.subarray(0,48),oversized]),path:'source.spz',code:'GAUSSIAN_SPZ_INVALID'},
  ];
  for(const {bytes,path,code} of cases){
    expect(()=>inspectGaussianSource(bytes,path)).toThrow(code);
    await expect(inspectGaussianSourceAsync(bytes,path)).rejects.toThrow(code);
  }
});

test('both GaussianStore import paths use cooperative validation and preserve the same immutable asset',async()=>{
  const fixture=gaussianFixture(0,{count:8193,proxy:false});
  const source=fixture.files.find(file=>file.path===fixture.manifest.splat)!;
  const files=await heartbeats(()=>new GaussianStore().importFiles(fixture.files));
  const raw=await heartbeats(()=>new GaussianStore().importRaw(source,[],fixture.manifest));
  expect(files.value.assetId).toBe(raw.value.assetId);expect(files.value.splatCount).toBe(8193);
  expect(files.ticks).toBeGreaterThanOrEqual(4);expect(raw.ticks).toBeGreaterThanOrEqual(8);
});
