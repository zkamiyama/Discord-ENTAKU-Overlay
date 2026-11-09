import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {saveRenderState} from '../../src/web/studio/render-state.ts';
test('nested passes restore target, projection layers, color and clipping state even after an exception',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),a=new THREE.WebGLRenderTarget(2,2),b=new THREE.WebGLRenderTarget(3,3);
 let target:THREE.WebGLRenderTarget|null=a,face=2,mip=1,alpha=.4,scissorTest=true;
 const viewport=new THREE.Vector4(1,2,3,4),scissor=new THREE.Vector4(5,6,7,8),color=new THREE.Color(.1,.2,.3);
 const renderer={autoClear:false,outputColorSpace:THREE.SRGBColorSpace as string,shadowMap:{autoUpdate:false},
  getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  getViewport:(out:THREE.Vector4)=>out.copy(viewport),getScissor:(out:THREE.Vector4)=>out.copy(scissor),getScissorTest:()=>scissorTest,
  getClearColor:(out:THREE.Color)=>out.copy(color),getClearAlpha:()=>alpha,
  setRenderTarget:(t:THREE.WebGLRenderTarget|null,f=0,m=0)=>{target=t;face=f;mip=m;},
  setClearColor:(c:THREE.Color,v:number)=>{color.copy(c);alpha=v;},setViewport:(v:THREE.Vector4)=>viewport.copy(v),setScissor:(v:THREE.Vector4)=>scissor.copy(v),setScissorTest:(v:boolean)=>{scissorTest=v;},
 };
 scene.background=new THREE.Color(0x123456);const original=scene.background;camera.layers.set(3);
 const restore=saveRenderState(renderer as unknown as THREE.WebGLRenderer,scene,camera);
 renderer.setRenderTarget(b);renderer.autoClear=true;camera.layers.set(4);
 const nested=saveRenderState(renderer as unknown as THREE.WebGLRenderer,scene,camera);
 renderer.setRenderTarget(null);camera.layers.set(5);nested();expect(target).toBe(b);expect(camera.layers.mask).toBe(1<<4);
 try{renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.shadowMap.autoUpdate=true;scene.background=null;viewport.set(0,0,99,99);scissorTest=false;throw Error('INJECTED');}
 catch{}finally{restore();}
 expect(target).toBe(a);expect(face).toBe(2);expect(mip).toBe(1);expect(alpha).toBe(.4);expect(viewport.toArray()).toEqual([1,2,3,4]);expect(scissor.toArray()).toEqual([5,6,7,8]);expect(scissorTest).toBe(true);
 expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);expect(renderer.autoClear).toBe(false);expect(renderer.shadowMap.autoUpdate).toBe(false);expect(scene.background).toBe(original);expect(camera.layers.mask).toBe(1<<3);a.dispose();b.dispose();
});
