import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {ResourceCache} from '../shared/resource-cache.ts';
import {disposeObject} from './dispose.ts';
import {prepareStudioMaterials} from './studio-materials.ts';

export interface StudioModelInstance {readonly root:THREE.Group;dispose():void}

/** Content-addressed GLB source assets own geometry, textures and image data.
 * SkeletonUtils clones node/bone/instancing state; materials are copied per
 * instance so participant opacity and speech never mutate another model. */
export class StudioModelRegistry{
 private readonly cache=new ResourceCache<THREE.Group,undefined>(undefined,disposeObject);
 constructor(private readonly load:(id:string,signal:AbortSignal)=>Promise<THREE.Group>){}
 get size():number{return this.cache.size;}
 async instantiate(id:string,signal:AbortSignal):Promise<StudioModelInstance>{
  signal.throwIfAborted();
  const lease=this.cache.acquire(id,s=>this.load(id,s));
  let rejectAbort!:(reason:unknown)=>void;
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{lease.release();rejectAbort(signal.reason);};
  signal.addEventListener('abort',onAbort,{once:true});
  let root:THREE.Group|undefined;
  const materials=new Map<THREE.Material,THREE.Material>(),owned=new Set<THREE.Material>();
  const cleanup=()=>{
   if(root)disposeObject(root,{sharedGeometry:true,sharedTextures:true,ownedMaterials:owned});
   lease.release();
  };
  try{
   const source=await Promise.race([lease.ready,aborted]);
   signal.throwIfAborted();
   root=clone(source) as THREE.Group;
   const copyMaterial=(material:THREE.Material):THREE.Material=>{
    let result=materials.get(material);
    if(!result){result=material.clone();materials.set(material,result);owned.add(result);}
    return result;
   };
   root.traverse(object=>{
    if(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.Points){
     object.material=Array.isArray(object.material)?object.material.map(copyMaterial):copyMaterial(object.material);
    }
   });
   prepareStudioMaterials(root);
   const instanceRoot=root;let released=false;
   return {root:instanceRoot,dispose(){if(!released){released=true;cleanup();}}};
  }catch(error){cleanup();throw error;}
  finally{signal.removeEventListener('abort',onAbort);}
 }
 diagnostics(){return this.cache.snapshot().map(({key,references,value})=>({id:key,references,ready:!!value}));}
 dispose():void{this.cache.dispose();}
}
