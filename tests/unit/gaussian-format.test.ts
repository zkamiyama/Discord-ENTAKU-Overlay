import {expect,test} from 'bun:test';
import {gzipSync,gunzipSync,zstdCompressSync} from 'node:zlib';
import {inspectGaussianSource} from '../../src/assets/gaussian-format.ts';
import {gaussianPly,gaussianSpz} from '../helpers/gaussian.ts';
import {GAUSSIAN_LIMITS} from '../../src/assets/gaussian-profile.ts';
test('published SPZ v1-v4 layouts validate bounded counts and complete payloads',()=>{
  for(const v of [1,2,3,4] as const){const bytes=gaussianSpz(v,5);expect(inspectGaussianSource(bytes,'avatar.spz')).toMatchObject({format:'spz',splatCount:5});expect(()=>inspectGaussianSource(bytes.subarray(0,bytes.length-2),'avatar.spz')).toThrow('GAUSSIAN_SPZ_INVALID');}
  const header=Buffer.from(gunzipSync(gaussianSpz(3)));header.writeUInt32LE(5,4);expect(()=>inspectGaussianSource(gzipSync(header),'avatar.spz')).toThrow('GAUSSIAN_SPZ_VERSION_UNSUPPORTED');
  header.writeUInt32LE(3,4);header[14]=2;expect(()=>inspectGaussianSource(gzipSync(header),'avatar.spz')).toThrow('GAUSSIAN_SPZ_EXTENSION_UNSUPPORTED');
  header[14]=0;header.writeUInt32LE(1_000_001,8);expect(()=>inspectGaussianSource(gzipSync(header),'avatar.spz')).toThrow('GAUSSIAN_SPLAT_LIMIT');
});
test('SPZ v4 refuses forged stream sizes and decompression exceeding declared output',()=>{
  const bad=Buffer.from(gaussianSpz(4));bad.writeBigUInt64LE(2n**62n,32);expect(()=>inspectGaussianSource(bad,'avatar.spz')).toThrow('GAUSSIAN_SPZ_INVALID');
  const normal=Buffer.from(gaussianSpz(4)),oversized=zstdCompressSync(Buffer.alloc(4096));normal.writeBigUInt64LE(BigInt(oversized.length),32);normal.writeBigUInt64LE(60n,40);
  expect(()=>inspectGaussianSource(Buffer.concat([normal.subarray(0,48),oversized]),'avatar.spz')).toThrow('GAUSSIAN_SPZ_INVALID');
});
test('3DGS PLY requires Gaussian fields and finite nondegenerate rotations',()=>{
  const bytes=gaussianPly(2,30);expect(inspectGaussianSource(bytes,'avatar.ply')).toMatchObject({format:'ply',splatCount:30});
  const pointCloud=Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n');
  expect(()=>inspectGaussianSource(pointCloud,'avatar.ply')).toThrow('GAUSSIAN_PLY_NOT_3DGS');
  const cut=bytes.subarray(0,bytes.length-1);expect(()=>inspectGaussianSource(cut,'avatar.ply')).toThrow('GAUSSIAN_PLY_DATA_INVALID');
  const bad=Buffer.from(bytes),header=bad.indexOf('end_header\n')+11;bad.writeFloatLE(Infinity,header);expect(()=>inspectGaussianSource(bad,'avatar.ply')).toThrow('GAUSSIAN_PLY_DATA_INVALID');
  bad.writeFloatLE(0,header);for(let i=13;i<17;i++)bad.writeFloatLE(0,header+i*4);expect(()=>inspectGaussianSource(bad,'avatar.ply')).toThrow('GAUSSIAN_PLY_DATA_INVALID');
  const huge=Buffer.from(bytes);const text=huge.toString('utf8',0,header).replace('vertex 30','vertex 1000001');expect(()=>inspectGaussianSource(Buffer.concat([Buffer.from(text),huge.subarray(header)]),'avatar.ply')).toThrow('GAUSSIAN_SPLAT_LIMIT');
});
test('ascii GS remains supported while unknown formats and image-size assumptions are rejected',()=>{
  const names=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
  const ascii=Buffer.from(`ply\nformat ascii 1.0\nelement vertex 1\n${names.map(n=>`property float ${n}`).join('\n')}\nend_header\n0 0 0 0 0 0 3 -3 -3 -3 1 0 0 0\n`);
  expect(inspectGaussianSource(ascii,'one.ply').splatCount).toBe(1);expect(()=>inspectGaussianSource(ascii,'one.splat')).toThrow('GAUSSIAN_FORMAT_UNSUPPORTED');
  expect(GAUSSIAN_LIMITS.fileBytes).toBeGreaterThan(32*1024*1024);
});
