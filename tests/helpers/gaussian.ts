/** Deterministically generated test characters, CC0. These are distinct synthetic
 * splat assets, not performance/quality substitutes for scanned characters. */
import {gzipSync,zstdCompressSync} from 'node:zlib';
import {zipSync} from 'fflate';
import type {GaussianAvatarManifest} from '../../src/assets/gaussian-profile.ts';
import type {GaussianFile} from '../../src/assets/gaussian-store.ts';
const colors = [[.95,.12,.08],[.1,.85,.18],[.12,.24,.95],[.95,.72,.08],[.85,.12,.75],[.05,.8,.85],[.9,.4,.08],[.6,.38,.95]] as const;
const fields=['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
function dimensions(index:number){return {width:.22+index*.012,height:1.5+(index%3)*.08,depth:.13+(index%4)*.012};}
export function gaussianPly(index=0,count=384+index*64,alternateColor=false):Uint8Array{
  const header=Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${fields.map(name=>`property float ${name}`).join('\n')}\nend_header\n`);
  const data=Buffer.alloc(count*fields.length*4),d=dimensions(index),color=colors[(index+(alternateColor?3:0))%colors.length]!;
  for(let i=0;i<count;i++){
    const head=i%4===0,t=(i+.5)/count,phi=i*2.399963229728653,y=head?d.height-.15+Math.cos(i*1.17)*.13:.12+t*(d.height-.4);
    const torsoShape=.65+.35*Math.sin(t*Math.PI),radius=head?.14:d.width*torsoShape;
    const x=Math.cos(phi)*radius,z=Math.sin(phi)*(head?.13:d.depth);
    const values=[x,y,z,0,0,0,...color.map(c=>(c-.5)/.28209479177387814),4,Math.log(.052),Math.log(.055),Math.log(.052),1,0,0,0];
    values.forEach((n,j)=>data.writeFloatLE(n,(i*fields.length+j)*4));
  }
  return Buffer.concat([header,data]);
}
function boxProxy(index:number):Uint8Array{
  const {width,height,depth}=dimensions(index),positions:number[]=[],normals:number[]=[],indices:number[]=[];
  function box(cx:number,cy:number,cz:number,hx:number,hy:number,hz:number){
    const faces=[{n:[0,0,1],p:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]},{n:[0,0,-1],p:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]},{n:[1,0,0],p:[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]},{n:[-1,0,0],p:[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]},{n:[0,1,0],p:[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]},{n:[0,-1,0],p:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]}];
    for(const face of faces){const base=positions.length/3;for(const p of face.p){positions.push(cx+p[0]!*hx,cy+p[1]!*hy,cz+p[2]!*hz);normals.push(...face.n);}indices.push(base,base+1,base+2,base,base+2,base+3);}
  }
  box(0,(height-.35)/2,0,width,(height-.35)/2,depth);box(0,height-.15,0,.14,.14,.13);
  const positionBytes=positions.length*4,normalBytes=normals.length*4,indexBytes=indices.length*2,bin=Buffer.alloc(positionBytes+normalBytes+indexBytes);
  positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));normals.forEach((v,i)=>bin.writeFloatLE(v,positionBytes+i*4));indices.forEach((v,i)=>bin.writeUInt16LE(v,positionBytes+normalBytes+i*2));
  const gltf={asset:{version:'2.0',generator:'ENTAKU CC0 synthetic fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positionBytes,target:34962},{buffer:0,byteOffset:positionBytes,byteLength:normalBytes,target:34962},{buffer:0,byteOffset:positionBytes+normalBytes,byteLength:indexBytes,target:34963}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-width,0,-depth],max:[width,height,depth]},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'},{bufferView:2,componentType:5123,count:indices.length,type:'SCALAR'}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:1}}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}]};
  const json=Buffer.from(JSON.stringify(gltf)),jsonPadded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(jsonPadded);const output=Buffer.alloc(12+8+jsonPadded.length+8+bin.length);
  output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);output.writeUInt32LE(jsonPadded.length,12);output.writeUInt32LE(0x4e4f534a,16);jsonPadded.copy(output,20);const at=20+jsonPadded.length;output.writeUInt32LE(bin.length,at);output.writeUInt32LE(0x004e4942,at+4);bin.copy(output,at+8);return output;
}
/** Independent tiny SPZ encoder for format boundary tests (degree zero). */
export function gaussianSpz(version:1|2|3|4,count=3):Uint8Array{
  const positionSize=version===1?6:9,rotationSize=version<3?3:4,payload=Buffer.alloc(count*(positionSize+1+3+3+rotationSize));
  for(let i=0;i<count;i++){
    if(version===1){payload.writeUInt16LE(0x3800,i*6);payload.writeUInt16LE(0x3c00,i*6+2);payload.writeUInt16LE(0,i*6+4);}
    else {payload.writeIntLE(Math.round((i-count/2)*.1*4096),i*9,3);payload.writeIntLE(Math.round((.4+i*.1)*4096),i*9+3,3);payload.writeIntLE(0,i*9+6,3);}
  }
  let offset=count*positionSize;payload.fill(240,offset,offset+count);offset+=count;payload.fill(180,offset,offset+count*3);offset+=count*3;payload.fill(100,offset,offset+count*3);offset+=count*3;
  if(version<3)payload.fill(128,offset); // v3+ packed zero means unit first quaternion.
  const header=Buffer.alloc(version===4?32:16);header.writeUInt32LE(0x5053474e,0);header.writeUInt32LE(version,4);header.writeUInt32LE(count,8);header[13]=12;
  if(version!==4)return gzipSync(Buffer.concat([header,payload]));
  header[15]=1;header.writeUInt32LE(32,16);const compressed=zstdCompressSync(payload),toc=Buffer.alloc(16);toc.writeBigUInt64LE(BigInt(compressed.length));toc.writeBigUInt64LE(BigInt(payload.length),8);return Buffer.concat([header,toc,compressed]);
}
export function gaussianFixture(index=0,options:{proxy?:boolean;format?:'ply'|'spz';count?:number;alternateColor?:boolean}={}){
  const splatCount=options.count??384+index*64,format=options.format??'ply',splat=`avatar.${format}`,d=dimensions(index),color=colors[(index+(options.alternateColor?3:0))%colors.length]!;
  const manifest:GaussianAvatarManifest={schemaVersion:1,kind:'entaku-gaussian-avatar',name:`合成キャラクター ${index+1}`,splat,...(options.proxy===false?{}:{proxy:'proxy.glb'}),coordinates:{units:'m',up:'+Y',forward:'+Z'},normalization:{scale:1,rotation:[0,0,0],translation:[0,0,0]},faceAnchor:[0,d.height-.15,0],faceBounds:{min:[-.15,d.height-.3,-.14],max:[.15,d.height,.14]},bodyBounds:{min:[-d.width-.06,-.06,-d.depth-.06],max:[d.width+.06,d.height+.06,d.depth+.06]},framingBounds:{min:[-d.width-.06,-.06,-d.depth-.06],max:[d.width+.06,d.height+.06,d.depth+.06]}};
  const files:GaussianFile[]=[{path:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest))},{path:splat,bytes:format==='ply'?gaussianPly(index,splatCount,options.alternateColor):gaussianSpz(3,splatCount)}];
  if(options.proxy!==false)files.push({path:'proxy.glb',bytes:boxProxy(index)});
  return {manifest,files,archive:zipSync(Object.fromEntries(files.map(f=>[f.path,f.bytes])),{level:1}),splatCount,color};
}
