import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {SplatMesh,type SparkRenderer} from '@sparkjsdev/spark';
import {GaussianViewPreparation} from '../../src/web/gaussian/view-preparation.ts';

function setup(addSource=true){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,30);camera.position.z=5;camera.updateMatrixWorld(true);
 const mesh=new THREE.Object3D() as SplatMesh;Object.setPrototypeOf(mesh,SplatMesh.prototype);
 Object.defineProperty(mesh,'isInitialized',{value:true});if(addSource)scene.add(mesh);
 const requests:Array<{resolve:()=>void;reject:(error:unknown)=>void}>=[];
 const initialized=new Set<THREE.Texture>();
 const view={renderSize:new THREE.Vector2(100,100),lodSplatCount:5,lodSplatScale:1,lodRenderScale:1,
  renderer:{initTexture:(texture:THREE.Texture)=>initialized.add(texture)},orderingTexture:null,
  currentLod:undefined,sorting:false,sortDirty:false,activeSplats:20,lodMeshes:[{mesh,version:0}],lodInstances:new Map(),display:{mapping:[]},
  update:()=>new Promise<void>((resolve,reject)=>requests.push({resolve,reject})),
 } as unknown as SparkRenderer;
 const complete=(count=4,displayed=count)=>{
  view.currentLod={pos:camera.position.clone(),quat:camera.quaternion.clone(),pixelScaleLimit:2/camera.projectionMatrix.elements[5]!/100,maxSplats:5,timestamp:1};
  view.activeSplats=count;
  view.orderingTexture??=new THREE.DataTexture();
  view.lodInstances.set(mesh,{lodId:1,numSplats:count,indices:new Uint32Array(),texture:new THREE.DataTexture()});
  view.display.mapping=[{node:mesh,base:0,count:displayed,version:0,mappingVersion:0} as SparkRenderer['display']['mapping'][number]];
 };
 return {preparation:new GaussianViewPreparation(),view,scene,camera,mesh,requests,complete,initialized};
}

test('new views advance one native update at a time and never admit a full-source fallback',async()=>{
 const p=setup(),advance=()=>p.preparation.advance(p.view,p.scene,p.camera);
 expect(advance()).toBe(false);expect(advance()).toBe(false);expect(p.requests).toHaveLength(1);
 p.complete(20);p.requests[0]!.resolve();await Promise.resolve();
 expect(p.initialized.has(p.view.orderingTexture!)).toBe(true);
 expect(p.initialized.has(p.view.lodInstances.get(p.mesh)!.texture)).toBe(true);
 expect(advance()).toBe(false);expect(p.requests).toHaveLength(2);
 p.complete(4,3);p.requests[1]!.resolve();await Promise.resolve();
 expect(advance()).toBe(false);expect(p.requests).toHaveLength(3);
 p.complete();p.view.sortDirty=true;p.requests[2]!.resolve();await Promise.resolve();
 expect(advance()).toBe(false);expect(p.requests).toHaveLength(4);
 p.view.sortDirty=false;p.requests[3]!.resolve();await Promise.resolve();
 expect(advance()).toBe(true);expect(p.preparation.isReady(p.view)).toBe(true);expect(p.requests).toHaveLength(4);
 // After the first valid display, normal native CUT/LoD updates retain it.
 p.camera.position.z=7;p.camera.updateMatrixWorld(true);expect(advance()).toBe(true);
});

test('retired completion and rejection cannot change a replacement preparation',async()=>{
 const p=setup(),advance=()=>p.preparation.advance(p.view,p.scene,p.camera);
 expect(advance()).toBe(false);p.preparation.clear();expect(advance()).toBe(false);
 p.requests[0]!.reject(new Error('RETIRED'));await Promise.resolve();
 expect(advance()).toBe(false);expect(p.requests).toHaveLength(2);
 p.complete();p.requests[1]!.resolve();await Promise.resolve();expect(advance()).toBe(true);
 p.preparation.clear();p.view.currentLod=undefined;expect(advance()).toBe(false);
 p.requests[2]!.reject(new Error('CURRENT'));await Promise.resolve();
 expect(advance).toThrow('GAUSSIAN_VIEW_PREPARATION_FAILED');
 p.preparation.clear();expect(p.preparation.isReady(p.view)).toBe(false);
});

test('an empty loading scene stays cold until its first initialized source arrives',()=>{
 const p=setup(false);p.complete();
 expect(p.preparation.advance(p.view,p.scene,p.camera)).toBe(false);expect(p.requests).toHaveLength(0);
 p.scene.add(p.mesh);p.view.currentLod=undefined;
 expect(p.preparation.advance(p.view,p.scene,p.camera)).toBe(false);expect(p.requests).toHaveLength(1);
 p.preparation.clear();p.requests[0]!.resolve();
});

test('completion after disposal never initializes retired GPU textures',async()=>{
 const p=setup();p.preparation.advance(p.view,p.scene,p.camera);p.complete();
 p.preparation.clear();p.requests[0]!.resolve();await Promise.resolve();
 expect(p.initialized.size).toBe(0);expect(p.preparation.isReady(p.view)).toBe(false);
});

for(const motion of ['position','rotation'] as const)test('native sub-threshold '+motion+' changes cannot leave a new view hidden',()=>{
 const p=setup();p.complete();
 if(motion==='position')p.camera.position.x+=.0005;else p.camera.rotateY(.004);
 p.camera.updateMatrixWorld(true);
 expect(p.preparation.advance(p.view,p.scene,p.camera)).toBe(true);expect(p.requests).toHaveLength(0);
});

test('ongoing small motion accepts a nearby native result and then keeps progressive updates',async()=>{
 const p=setup(),advance=()=>p.preparation.advance(p.view,p.scene,p.camera);
 expect(advance()).toBe(false);p.complete();
 for(let frame=0;frame<4;frame++){
  p.camera.position.x+=.0001;p.camera.updateMatrixWorld(true);expect(advance()).toBe(false);
 }
 p.requests[0]!.resolve();await Promise.resolve();expect(advance()).toBe(true);
 for(let frame=0;frame<20;frame++){
  p.camera.position.x+=.0001;p.camera.updateMatrixWorld(true);expect(advance()).toBe(true);
 }
});

test('a startup CUT explicitly refreshes native LoD before admitting its display',async()=>{
 const p=setup();p.complete();p.view.lodDirty=false;
 p.camera.position.z+=4;p.camera.rotateY(Math.PI);p.camera.updateMatrixWorld(true);
 expect(p.preparation.advance(p.view,p.scene,p.camera)).toBe(false);expect(p.view.lodDirty).toBe(true);
 p.complete();p.view.lodDirty=false;p.requests[0]!.resolve();await Promise.resolve();
 expect(p.preparation.advance(p.view,p.scene,p.camera)).toBe(true);
});
