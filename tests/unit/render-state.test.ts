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

test('target pixel viewport and scissor survive nested passes without overwriting the canvas logical state',()=>{
 const scene=new THREE.Scene(),a=new THREE.WebGLRenderTarget(320,360),b=new THREE.WebGLRenderTarget(64,64);
 const logicalViewport=new THREE.Vector4(0,0,320,180),logicalScissor=new THREE.Vector4(4,5,200,100);
 const currentViewport=new THREE.Vector4(),currentScissor=new THREE.Vector4(),color=new THREE.Color();
 let target:THREE.WebGLRenderTarget|null=null,logicalTest=false,currentTest=false;
 a.viewport.set(12,18,240,300);a.scissor.set(10,20,200,220);a.scissorTest=true;
 // Model Three's separate global logical values and active framebuffer pixels.
 const renderer={autoClear:true,outputColorSpace:THREE.SRGBColorSpace,shadowMap:{autoUpdate:false},
  getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getViewport:(out:THREE.Vector4)=>out.copy(logicalViewport),getScissor:(out:THREE.Vector4)=>out.copy(logicalScissor),getScissorTest:()=>logicalTest,
  getClearColor:(out:THREE.Color)=>out.copy(color),getClearAlpha:()=>0,setClearColor:()=>{},
  setViewport:(value:THREE.Vector4)=>{logicalViewport.copy(value);currentViewport.copy(value).multiplyScalar(target?1:2);},
  setScissor:(value:THREE.Vector4)=>{logicalScissor.copy(value);currentScissor.copy(value).multiplyScalar(target?1:2);},
  setScissorTest:(value:boolean)=>{logicalTest=value;currentTest=value;},
  setRenderTarget:(value:THREE.WebGLRenderTarget|null)=>{
   target=value;currentViewport.copy(value?.viewport??logicalViewport);currentScissor.copy(value?.scissor??logicalScissor);
   if(!value){currentViewport.multiplyScalar(2);currentScissor.multiplyScalar(2);}
   currentTest=value?.scissorTest??logicalTest;
  },
 };
 const typed=renderer as unknown as THREE.WebGLRenderer;
 renderer.setRenderTarget(a);const restore=saveRenderState(typed,scene);
 renderer.setRenderTarget(b);const nested=saveRenderState(typed,scene);
 renderer.setRenderTarget(null);renderer.setViewport(new THREE.Vector4(0,0,999,999));renderer.setScissorTest(true);
 nested();expect(currentViewport.toArray()).toEqual([0,0,64,64]);expect(currentTest).toBe(false);
 restore();expect(typed.getRenderTarget()).toBe(a);expect(currentViewport.toArray()).toEqual([12,18,240,300]);
 expect(currentScissor.toArray()).toEqual([10,20,200,220]);expect(currentTest).toBe(true);
 expect(logicalViewport.toArray()).toEqual([0,0,320,180]);expect(logicalScissor.toArray()).toEqual([4,5,200,100]);
 renderer.setRenderTarget(null);expect(currentViewport.toArray()).toEqual([0,0,640,360]);expect(currentScissor.toArray()).toEqual([8,10,400,200]);expect(currentTest).toBe(false);
 a.dispose();b.dispose();
});
