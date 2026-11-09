import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {VibranceShader,naturalVibrance} from '../../src/web/studio/vibrance-shader.ts';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')!,alpha:true});renderer.setSize(4,1,false);
const pixels=new Uint8Array([128,102,76,255,242,38,13,255,102,102,102,128,255,0,0,0]);
const texture=new THREE.DataTexture(pixels,4,1,THREE.RGBAFormat);texture.needsUpdate=true;
const material=new THREE.ShaderMaterial({...VibranceShader,uniforms:THREE.UniformsUtils.clone(VibranceShader.uniforms),toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending});
material.uniforms.tDiffuse!.value=texture;
const quad=new FullScreenQuad(material),target=new THREE.WebGLRenderTarget(4,1,{depthBuffer:false});
(window as any).vibranceProbe=(amount:number)=>{
 material.uniforms.amount!.value=amount;renderer.setRenderTarget(target);quad.render(renderer);const output=new Uint8Array(16);renderer.readRenderTargetPixels(target,0,0,4,1,output);
 const expected:number[]=[];for(let i=0;i<16;i+=4)expected.push(...naturalVibrance([...pixels.slice(i,i+3)].map(v=>v/255),amount).map(v=>Math.round(v*255)),pixels[i+3]!);
 return {output:[...output],expected};
};
