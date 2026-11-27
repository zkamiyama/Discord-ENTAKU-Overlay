import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {GaussianSpeechHalo,GaussianSpeechHaloPool} from '../../src/web/gaussian/speech-halo.ts';

test('speech mask failure restores original imported material and renderer state',()=>{
 for(const failAt of ['depth','mask']){
  const halo=new GaussianSpeechHalo(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const original=new THREE.MeshStandardMaterial({transparent:true,alphaTest:.3,depthWrite:false});
  const geometry=new THREE.PlaneGeometry();scene.add(new THREE.Mesh(geometry,original));
  scene.background=new THREE.Color(0x123456);const background=scene.background;camera.layers.set(1);
  let target:THREE.WebGLRenderTarget|null=null,face=2,mip=1,alpha=.4,scissorTest=true;
  const viewport=new THREE.Vector4(1,2,300,200),scissor=new THREE.Vector4(5,6,100,90),color=new THREE.Color(.1,.2,.3);
  const renderer={autoClear:true,outputColorSpace:THREE.SRGBColorSpace,shadowMap:{autoUpdate:true},
   getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
   getViewport:(out:THREE.Vector4)=>out.copy(viewport),getScissor:(out:THREE.Vector4)=>out.copy(scissor),getScissorTest:()=>scissorTest,
   getClearColor:(out:THREE.Color)=>out.copy(color),getClearAlpha:()=>alpha,
   setRenderTarget:(next:THREE.WebGLRenderTarget|null,f=0,m=0)=>{target=next;face=f;mip=m;},
   setClearColor:(next:THREE.Color|number,a:number)=>{color.set(next);alpha=a;},
   setViewport:(v:THREE.Vector4)=>viewport.copy(v),setScissor:(v:THREE.Vector4)=>scissor.copy(v),setScissorTest:(v:boolean)=>{scissorTest=v;},clear:()=>{},
   render:()=>{
    expect(original.colorWrite).toBe(false);expect(original.alphaTest).toBe(.3);
    expect(original.depthWrite).toBe(false);expect(original.transparent).toBe(true);
    if(failAt==='depth')throw new Error('INJECTED_DEPTH');
   },
  };
  try{
   expect(()=>halo.prepare(renderer as unknown as THREE.WebGLRenderer,scene,camera,()=>{throw new Error('INJECTED_MASK');},new THREE.Color())).toThrow('INJECTED_');
   expect(original.colorWrite).toBe(true);expect(original.alphaTest).toBe(.3);expect(original.depthWrite).toBe(false);
   expect(target).toBeNull();expect(face).toBe(2);expect(mip).toBe(1);expect(alpha).toBe(.4);
   expect(viewport.toArray()).toEqual([1,2,300,200]);expect(scissor.toArray()).toEqual([5,6,100,90]);expect(scissorTest).toBe(true);
   expect(renderer.autoClear).toBe(true);expect(renderer.shadowMap.autoUpdate).toBe(true);expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
   expect(scene.background).toBe(background);expect(camera.layers.mask).toBe(1<<1);expect(halo.composite.visible).toBe(false);
  }finally{halo.dispose();original.dispose();geometry.dispose();}
 }
});

test('odd split sizes reuse two bounded halo target sets and retire every evicted resource',()=>{
 const scene=new THREE.Scene(),pool=new GaussianSpeechHaloPool(scene);
 const first=pool.acquire(400,450),second=pool.acquire(401,450);
 const resources=(halo:GaussianSpeechHalo)=>{
  // Observe actual target/material disposal, including the private field pair.
  const fields=halo as unknown as {a:THREE.WebGLRenderTarget;b:THREE.WebGLRenderTarget;seed:{material:THREE.Material};spread:{material:THREE.Material}};
  return [halo.mask,fields.a,fields.b,halo.composite.geometry,halo.composite.material,fields.seed.material,fields.spread.material];
 };
 const disposals=new Map<object,number>();
 for(const halo of [first,second])for(const resource of resources(halo)){
  disposals.set(resource,0);resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)!+1));
 }
 for(let frame=0;frame<4;frame++){
  first.composite.visible=true;expect(pool.acquire(401,450)).toBe(second);expect(first.composite.visible).toBe(false);
  second.composite.visible=true;expect(pool.acquire(400,450)).toBe(first);expect(second.composite.visible).toBe(false);
 }
 expect(pool.size).toBe(2);expect(scene.children).toHaveLength(2);expect([...disposals.values()].every(count=>count===0)).toBe(true);
 const third=pool.acquire(800,450);expect(pool.size).toBe(2);expect(scene.children).toHaveLength(2);
 expect(second.composite.parent).toBeNull();expect(first.composite.parent).toBe(scene);expect(third.composite.parent).toBe(scene);
 for(const resource of resources(second))expect(disposals.get(resource)).toBe(1);
 for(const resource of resources(first))expect(disposals.get(resource)).toBe(0);
 first.composite.visible=true;third.composite.visible=true;pool.hide();expect(scene.children.every(object=>!object.visible)).toBe(true);
 pool.dispose();pool.dispose();expect(pool.size).toBe(0);expect(scene.children).toHaveLength(0);
 for(const count of disposals.values())expect(count).toBe(1);
});
