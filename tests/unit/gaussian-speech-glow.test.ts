import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
import {MAX_GAUSSIAN_SPEAKERS,fillGaussianSpeechRanges,setGaussianSpeechGlow,clearGaussianSpeechGlow,installGaussianSpeechGlow} from '../../src/web/gaussian/speech-glow.ts';

const ranges=()=>Array.from({length:MAX_GAUSSIAN_SPEAKERS},()=>new THREE.Vector4());
const record=(node:SplatMesh,base:number,count:number)=>({node,base,count,version:0});

test('speech belongs to the instance and current displayed LoD mapping, not shared data or source count',()=>{
 const a=Object.create(SplatMesh.prototype) as SplatMesh,b=Object.create(SplatMesh.prototype) as SplatMesh;
 a.visible=b.visible=true;a.parent=b.parent=null;
 const out=ranges();setGaussianSpeechGlow(a,.7,8);
 expect(fillGaussianSpeechRanges([record(a,512,102),record(b,2048,83)],out)).toBe(1);
 expect(out[0]!.toArray()).toEqual([512,614,.7,2]);
 // Other view assigns the same meshes different bases/counts and order.
 expect(fillGaussianSpeechRanges([record(b,0,900),record(a,4096,17)],out)).toBe(1);
 expect(out[0]!.toArray()).toEqual([4096,4113,.7,2]);
 setGaussianSpeechGlow(a,0);setGaussianSpeechGlow(b,.4,1);
 fillGaussianSpeechRanges([record(a,0,1000),record(b,8192,5)],out);
 expect(out[0]!.toArray()).toEqual([8192,8197,.4,.25]);
 expect(out.slice(1).every(v=>v.lengthSq()===0)).toBe(true);
 clearGaussianSpeechGlow(a);clearGaussianSpeechGlow(b);
});

test('all 32 participants, hidden ancestors, invalid inputs and retired entries are bounded',()=>{
 const meshes=Array.from({length:32},()=>{const m=Object.create(SplatMesh.prototype) as SplatMesh;m.visible=true;m.parent=null;return m;});
 const mapping=meshes.map((m,i)=>record(m,i*16384,500)),out=ranges();
 meshes.forEach(m=>setGaussianSpeechGlow(m,2,Infinity));
 expect(fillGaussianSpeechRanges(mapping,out)).toBe(32);
 expect(out[31]!.toArray()).toEqual([31*16384,31*16384+500,1,1]);
 expect(()=>fillGaussianSpeechRanges(mapping,out.slice(0,8))).toThrow('GAUSSIAN_SPEECH_RANGE_OVERFLOW');
 const parent=new THREE.Group();parent.visible=false;meshes[0]!.parent=parent;
 expect(fillGaussianSpeechRanges(mapping,out)).toBe(31);
 setGaussianSpeechGlow(meshes[1]!,NaN);clearGaussianSpeechGlow(meshes[2]!);
 expect(fillGaussianSpeechRanges(mapping,out)).toBe(29);
 expect(fillGaussianSpeechRanges([],out)).toBe(0);expect(out.every(v=>v.lengthSq()===0)).toBe(true);
 meshes.forEach(clearGaussianSpeechGlow);
});

test('adapter guards published shaders and restores its instance without changing shared chunks',()=>{
 const renderer={getContext:()=>({getExtension:()=>null})} as unknown as THREE.WebGLRenderer;
 const spark=new SparkRenderer({renderer}),source=spark.material.vertexShader,fragment=spark.material.fragmentShader;
 const chunks=JSON.stringify(THREE.ShaderChunk),before=spark.onBeforeRender;
 const effect=installGaussianSpeechGlow(spark);
 expect(spark.material.vertexShader).toContain('speakerRanges[32]');
 expect(spark.material.fragmentShader).toContain('sRGBTransferOETF(vec4(linearOut,1.0))');
 expect(spark.material.fragmentShader).toContain('rgba.a * exp(-0.5 * z2)');
 expect(spark.material.depthTest).toBe(true);expect(spark.material.depthWrite).toBe(false);
 expect(effect.uniforms.rimMode.value).toBe(2);
 expect(JSON.stringify(THREE.ShaderChunk)).toBe(chunks);
 effect.dispose();expect(spark.onBeforeRender).toBe(before);
 expect(spark.material.vertexShader).toBe(source);expect(spark.material.fragmentShader).toBe(fragment);
 expect(spark.material.uniforms.speakerRanges).toBeUndefined();
 spark.material.vertexShader=source.replace('vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);','changed');
 expect(()=>installGaussianSpeechGlow(spark)).toThrow('SPARK_2_4_SHADER_HOOK_CHANGED');spark.dispose();
});

test('draw-node uniforms use the active view AFTER the native callback replaces displayed data',()=>{
 const renderer={getContext:()=>({getExtension:()=>null})} as unknown as THREE.WebGLRenderer;
 const node=new SparkRenderer({renderer}),other=new SparkRenderer({renderer});
 const mesh=Object.create(SplatMesh.prototype) as SplatMesh;mesh.visible=true;mesh.parent=null;
 setGaussianSpeechGlow(mesh,.8);node.display.mapping=[record(mesh,0,99)];
 node.onBeforeRender=()=>{other.display.mapping=[record(mesh,512,7)];};
 const effect=installGaussianSpeechGlow(node,()=>other);
 node.onBeforeRender(renderer,new THREE.Scene(),new THREE.PerspectiveCamera());
 expect(effect.uniforms.speakerRanges.value[0]!.toArray()).toEqual([512,519,.8,1]);
 clearGaussianSpeechGlow(mesh);effect.dispose();node.dispose();other.dispose();
});
