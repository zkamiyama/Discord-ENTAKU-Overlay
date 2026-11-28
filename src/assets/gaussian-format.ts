import {gunzip,gunzipSync,zstdDecompress,zstdDecompressSync} from 'node:zlib';
import {promisify} from 'node:util';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {GAUSSIAN_LIMITS,type GaussianBounds} from './gaussian-profile.ts';
export interface GaussianSourceInfo { format: 'ply'|'spz'; splatCount: number; bounds?: GaussianBounds }
const decoder = new TextDecoder('utf-8', {fatal:true});
const sizes: Record<string,number> = {char:1,int8:1,uchar:1,uint8:1,short:2,int16:2,ushort:2,uint16:2,int:4,int32:4,uint:4,uint32:4,float:4,float32:4,double:8,float64:8};
const required = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
type Decompression={codec:'gzip'|'zstd';bytes:Uint8Array;maximum:number};
type Inspection=Generator<Decompression|null,GaussianSourceInfo,Uint8Array|undefined>;
const gunzipAsync=promisify(gunzip),zstdAsync=promisify(zstdDecompress);
const batchPoints=1024;
/** Both APIs drive this same parser. null is a cooperative checkpoint; a
 * decompression request is run by the synchronous or asynchronous zlib API. */
function* ply(bytes: Uint8Array): Inspection {
  const headerEnd = Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(bytes.byteLength,65536)).indexOf('end_header\n');
  const crlfEnd = headerEnd < 0 ? Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(bytes.byteLength,65536)).indexOf('end_header\r\n') : -1;
  const end = headerEnd >= 0 ? headerEnd + 11 : crlfEnd >= 0 ? crlfEnd + 12 : -1;
  if (end < 0) throw new Error('GAUSSIAN_PLY_HEADER_INVALID');
  const lines = decoder.decode(bytes.subarray(0,end)).trim().split(/\r?\n/);
  if (lines[0] !== 'ply') throw new Error('GAUSSIAN_PLY_HEADER_INVALID');
  let format = '', count = -1, activeVertex = false, stride = 0;
  const properties: Array<{name:string;type:string;offset:number}> = [];
  for (const line of lines.slice(1)) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'format') {
      if (format || words[2] !== '1.0' || !['ascii','binary_little_endian'].includes(words[1]!)) throw new Error('GAUSSIAN_PLY_FORMAT_UNSUPPORTED');
      format = words[1]!;
    } else if (words[0] === 'element') {
      activeVertex = words[1] === 'vertex';
      const n = Number(words[2]);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('GAUSSIAN_PLY_HEADER_INVALID');
      if (activeVertex) { if (count !== -1) throw new Error('GAUSSIAN_PLY_HEADER_INVALID'); count = n; }
      else if (n !== 0) throw new Error('GAUSSIAN_PLY_FORMAT_UNSUPPORTED');
    } else if (words[0] === 'property' && activeVertex) {
      if (words.length !== 3 || !sizes[words[1]!] || properties.some(p => p.name === words[2])) throw new Error('GAUSSIAN_PLY_FORMAT_UNSUPPORTED');
      properties.push({type:words[1]!,name:words[2]!,offset:stride}); stride += sizes[words[1]!]!;
      if (properties.length > 128) throw new Error('GAUSSIAN_PLY_HEADER_INVALID');
    }
  }
  if (!format || count < 1 || !stride) throw new Error('GAUSSIAN_PLY_HEADER_INVALID');
  if (count > GAUSSIAN_LIMITS.splats) throw new Error('GAUSSIAN_SPLAT_LIMIT');
  if (required.some(name => !properties.some(p => p.name === name))) throw new Error('GAUSSIAN_PLY_NOT_3DGS');
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  const needed = required.map(name => properties.findIndex(p => p.name === name));
  const validate = (values: number[]) => {
    if (values.some(v => !Number.isFinite(v))) throw new Error('GAUSSIAN_PLY_DATA_INVALID');
    for (let i=0;i<3;i++) { const n=values[needed[i]!]!; if (Math.abs(n)>1e6) throw new Error('GAUSSIAN_PLY_DATA_INVALID'); min[i]=Math.min(min[i]!,n);max[i]=Math.max(max[i]!,n); }
    for (let i=7;i<10;i++) if (Math.abs(values[needed[i]!]!)>30) throw new Error('GAUSSIAN_PLY_DATA_INVALID');
    if (Math.hypot(...needed.slice(10).map(i=>values[i]!))<1e-12) throw new Error('GAUSSIAN_PLY_DATA_INVALID');
  };
  if (format === 'ascii') {
    // Read one row at a time: splitting the whole ASCII payload would allocate
    // every row before an asynchronous caller could yield. Outer blank rows
    // keep the previous trim() behaviour; an interior blank row is invalid.
    const data=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let cursor=end,rows=0,blank=false,scanned=0;
    while(cursor<bytes.length){
      const newline=data.indexOf(10,cursor),stop=newline<0?bytes.length:newline;
      const row=decoder.decode(bytes.subarray(cursor,stop)).trim();cursor=stop+1;
      if(!row){if(rows)blank=true;}
      else{
        if(blank||++rows>count)throw new Error('GAUSSIAN_PLY_DATA_INVALID');
        const tokens=row.split(/\s+/);if(tokens.length!==properties.length)throw new Error('GAUSSIAN_PLY_DATA_INVALID');validate(tokens.map(Number));
      }
      if(++scanned%batchPoints===0)yield null;
    }
    if(rows!==count)throw new Error('GAUSSIAN_PLY_DATA_INVALID');
  } else {
    if (bytes.byteLength-end !== count*stride) throw new Error('GAUSSIAN_PLY_DATA_INVALID');
    const data=new DataView(bytes.buffer,bytes.byteOffset+end,bytes.byteLength-end);
    const read=(offset:number,type:string) => {
      switch(type){
        case 'char': case 'int8':return data.getInt8(offset);
        case 'uchar':case 'uint8':return data.getUint8(offset);
        case 'short':case 'int16':return data.getInt16(offset,true);
        case 'ushort':case 'uint16':return data.getUint16(offset,true);
        case 'int':case 'int32':return data.getInt32(offset,true);
        case 'uint':case 'uint32':return data.getUint32(offset,true);
        case 'double':case 'float64':return data.getFloat64(offset,true);
        default:return data.getFloat32(offset,true);
      }
    };
    for(let i=0;i<count;i++){
      validate(properties.map(p=>read(i*stride+p.offset,p.type)));
      if((i+1)%batchPoints===0)yield null;
    }
  }
  // Degenerate axes are valid splats; leave enough room for an editable default box.
  return {format:'ply',splatCount:count,bounds:{min:min.map((v,i)=>v===max[i]?v-.01:v) as unknown as GaussianBounds['min'],max:max.map((v,i)=>v===min[i]?v+.01:v) as unknown as GaussianBounds['max']}};
}
/** Bounded format inspection follows Spark 2.4.0's spz.rs section layout.
 * Unknown packing extensions are rejected rather than silently misinterpreted. */
function* spz(bytes:Uint8Array):Inspection {
  const rawMagic=bytes.length>=4?new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true):0;
  let decoded:Uint8Array;
  if(rawMagic===0x5053474e)decoded=bytes;
  else decoded=(yield {codec:'gzip',bytes,maximum:GAUSSIAN_LIMITS.fileBytes})!;
  if(decoded.length<16)throw new Error('GAUSSIAN_SPZ_INVALID');
  const view=new DataView(decoded.buffer,decoded.byteOffset,decoded.byteLength);
  if(view.getUint32(0,true)!==0x5053474e)throw new Error('GAUSSIAN_SPZ_INVALID');
  const version=view.getUint32(4,true),count=view.getUint32(8,true),degree=decoded[12]!,bits=decoded[13]!,flags=decoded[14]!;
  if(![1,2,3,4].includes(version)||(version===4)!==(rawMagic===0x5053474e))throw new Error('GAUSSIAN_SPZ_VERSION_UNSUPPORTED');
  if(count<1||count>GAUSSIAN_LIMITS.splats)throw new Error('GAUSSIAN_SPLAT_LIMIT');
  if(degree>3||bits>24)throw new Error('GAUSSIAN_SPZ_INVALID');
  if(flags&~1)throw new Error('GAUSSIAN_SPZ_EXTENSION_UNSUPPORTED');
  const requiredBytes=count*((version===1?6:9)+1+3+3+(version<3?3:4)+3*((degree+1)**2-1));
  let payload:Uint8Array;
  if(version===4){
    if(decoded.length<32)throw new Error('GAUSSIAN_SPZ_INVALID');
    const streams=decoded[15]!,toc=view.getUint32(16,true),tocEnd=toc+streams*16;
    if(streams<1||streams>16||toc<32||tocEnd>decoded.length)throw new Error('GAUSSIAN_SPZ_INVALID');
    const chunks:Uint8Array[]=[];let cursor=tocEnd,total=0;
    for(let i=0;i<streams;i++){
      const compressed=Number(view.getBigUint64(toc+i*16,true)),uncompressed=Number(view.getBigUint64(toc+i*16+8,true));
      if(!Number.isSafeInteger(compressed)||compressed<1||cursor+compressed>decoded.length||!Number.isSafeInteger(uncompressed)||uncompressed<0||total+uncompressed>requiredBytes)throw new Error('GAUSSIAN_SPZ_INVALID');
      const chunk=(yield {codec:'zstd',bytes:decoded.subarray(cursor,cursor+compressed),maximum:Math.max(1,uncompressed)})!;
      if(chunk.length!==uncompressed)throw new Error('GAUSSIAN_SPZ_INVALID');
      chunks.push(chunk);total+=chunk.length;cursor+=compressed;
    }
    if(cursor!==decoded.length||total!==requiredBytes)throw new Error('GAUSSIAN_SPZ_INVALID');
    payload=new Uint8Array(total);let offset=0;
    for(const chunk of chunks)for(let start=0;start<chunk.length;start+=1024*1024){
      const part=chunk.subarray(start,start+1024*1024);payload.set(part,offset);offset+=part.length;yield null;
    }
  }else{
    if(decoded[15]!==0||decoded.length!==16+requiredBytes)throw new Error('GAUSSIAN_SPZ_INVALID');
    payload=decoded.subarray(16);
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++){
    for(let axis=0;axis<3;axis++){
      const at=(i*3+axis)*(version===1?2:3);let value:number;
      if(version===1){const h=payload[at]!|(payload[at+1]!<<8),sign=h&0x8000?-1:1,exp=(h>>10)&31,mantissa=h&1023;value=exp===0?sign*2**-14*(mantissa/1024):exp===31?NaN:sign*2**(exp-15)*(1+mantissa/1024);}
      else{let packed=payload[at]!|(payload[at+1]!<<8)|(payload[at+2]!<<16);if(packed&0x800000)packed|=0xff000000;value=packed/2**bits;}
      if(!Number.isFinite(value)||Math.abs(value)>1e6)throw new Error('GAUSSIAN_SPZ_INVALID');
      min[axis]=Math.min(min[axis]!,value);max[axis]=Math.max(max[axis]!,value);
    }
    if((i+1)%batchPoints===0)yield null;
  }
  return {format:'spz',splatCount:count,bounds:{min:min.map((v,i)=>v===max[i]?v-.01:v) as unknown as GaussianBounds['min'],max:max.map((v,i)=>v===min[i]?v+.01:v) as unknown as GaussianBounds['max']}};
}
function inspection(bytes:Uint8Array,path:string):Inspection {
  if(bytes.byteLength>GAUSSIAN_LIMITS.fileBytes)throw new Error('GAUSSIAN_FILE_TOO_LARGE');
  if(/\.ply$/i.test(path))return ply(bytes);
  if(/\.spz$/i.test(path))return spz(bytes);
  throw new Error('GAUSSIAN_FORMAT_UNSUPPORTED');
}
export function inspectGaussianSource(bytes:Uint8Array,path:string):GaussianSourceInfo {
  const work=inspection(bytes,path);let step=work.next();
  while(!step.done){
    let output:Uint8Array|undefined;
    if(step.value){
      const {codec,bytes,maximum}=step.value;
      try{output=(codec==='gzip'?gunzipSync:zstdDecompressSync)(bytes,{maxOutputLength:maximum});}
      catch{throw new Error('GAUSSIAN_SPZ_INVALID');}
    }
    step=work.next(output);
  }
  return step.value;
}
/** Used by imports so point scans and gzip/zstd expansion leave room for live
 * voice, camera and WebSocket work. Every point and bound is still inspected. */
export async function inspectGaussianSourceAsync(bytes:Uint8Array,path:string):Promise<GaussianSourceInfo> {
  const work=inspection(bytes,path);let step=work.next();
  while(!step.done){
    let output:Uint8Array|undefined;
    if(step.value){
      const {codec,bytes,maximum}=step.value;
      try{output=await (codec==='gzip'?gunzipAsync:zstdAsync)(bytes,{maxOutputLength:maximum});}
      catch{throw new Error('GAUSSIAN_SPZ_INVALID');}
    }else await yieldTurn();
    step=work.next(output);
  }
  return step.value;
}
