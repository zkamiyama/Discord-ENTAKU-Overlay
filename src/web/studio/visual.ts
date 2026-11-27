import * as THREE from 'three';
import {studioVisualKey} from '../../studio/change-keys.ts';
import type {StudioScene} from '../../studio/manifest.ts';
import type {StudioClient} from '../shared/client.ts';
import {BroadcastSet} from './broadcast-set.ts';
import {loadStudioBundle} from './loader.ts';
import {disposeObject} from './dispose.ts';
import {MeshSpeechGlow} from './mesh-speech.ts';
import {StudioModelRegistry,type StudioModelInstance} from './model-registry.ts';

interface StudioGeneration {
 root:THREE.Group;
 definition:StudioScene;
 broadcast:BroadcastSet|null;
 models:StudioModelInstance[];
 speakers:MeshSpeechGlow[];
 speakerIds:Set<string>;
}
function releaseGeneration(generation:StudioGeneration):void{
 for(const speaker of generation.speakers)speaker.dispose();
 // Remove borrowed-resource models before disposing the primitive scene.
 for(const model of generation.models)model.dispose();
 disposeObject(generation.root);
}

/** A candidate owns its instances until it is complete. Immutable bundle
 * sources are leased across overlapping generations and repeated placements.
 * Failed/cancelled candidates cannot mutate or retire the active scene. */
export class StudioVisual {
 readonly root=new THREE.Group();
 private generation=0;
 private revision=0;
 private signature='';
 private disposed=false;
 private pending?:AbortController;
 private active:StudioGeneration|null=null;
 private meshVisibilityVersion=0;
 private readonly models:StudioModelRegistry;
 loading=false;
 error='';
 authoredLights=0;
 constructor(client:StudioClient,renderer:THREE.WebGLRenderer,loadModel:typeof loadStudioBundle=loadStudioBundle){
  this.models=new StudioModelRegistry((id,signal)=>loadModel(client,renderer,id,signal));
 }
 get renderGeneration():number{return this.revision;}
 get readyForCamera():boolean{return this.active!==null;}
 get meshVisibilityRevision():number{return this.meshVisibilityVersion;}
 hasMeshSpeaker(userId:string):boolean{return this.root.visible&&!!this.active?.speakerIds.has(userId);}
 get meshSpeechCount():number{return this.active?.speakers.length??0;}
 get activeMeshSpeakers():number{return this.active?.speakers.filter(mesh=>mesh.active).length??0;}
 diagnostics(){return {generation:this.revision,models:this.models.diagnostics()};}
 private recountLights():void{
  let lights=0;
  this.active?.root.traverseVisible(o=>{if(o instanceof THREE.Light&&o.intensity>0)lights++;});
  this.authoredLights=lights;
 }
 setMeshSpeech(states:ReadonlyMap<string,{visible:boolean;opacity:number;intensity:number}>,scale:number):void{
  let changed=false;
  for(const mesh of this.active?.speakers??[]){
   const state=states.get(mesh.speakerUserId),visible=!!state?.visible;
   if(mesh.object.visible!==visible){mesh.object.visible=visible;changed=true;}
   mesh.setPresence(state?.visible?state.opacity:0);
   mesh.setSpeech(this.root.visible&&state?.visible?state.intensity:0,scale);
  }
  if(changed){this.meshVisibilityVersion++;this.recountLights();}
 }
 async update(definition:StudioScene):Promise<void>{
  if(this.disposed)return;
  const signature=studioVisualKey(definition);
  if(signature===this.signature)return;
  this.signature=signature;
  this.pending?.abort();
  const controller=new AbortController(),signal=controller.signal,version=++this.generation;
  this.pending=controller;this.loading=true;this.error='';
  const candidate:StudioGeneration={root:new THREE.Group(),definition,broadcast:null,models:[],speakers:[],speakerIds:new Set()};
  let committed=false;
  try{
   if(definition.broadcast?.enabled){
    const broadcast=new BroadcastSet(definition.broadcast.title,definition.broadcast.subtitle);
    broadcast.position.fromArray(definition.tableAnchor.position);broadcast.rotation.y=THREE.MathUtils.degToRad(definition.tableAnchor.yawDeg);
    candidate.broadcast=broadcast;candidate.root.add(broadcast);
   }
   for(const item of definition.objects){
    signal.throwIfAborted();
    let object:THREE.Object3D;
    if(item.kind==='model'){
     const instance=await this.models.instantiate(item.bundleId,signal);
     candidate.models.push(instance);object=instance.root;
    }else if(item.kind==='box')object=new THREE.Mesh(new THREE.BoxGeometry(...item.size),new THREE.MeshStandardMaterial({color:item.color,roughness:.75}));
    else if(item.kind==='plane'){
     const plane=new THREE.Mesh(new THREE.PlaneGeometry(...item.size),new THREE.MeshStandardMaterial({color:item.color,side:THREE.DoubleSide,roughness:.9}));
     plane.rotation.x=-Math.PI/2;object=new THREE.Group();object.add(plane);
    }else object=new THREE.PointLight(item.color,item.intensity);
    if('transform' in item){
     object.position.fromArray(item.transform.position);object.rotation.y=THREE.MathUtils.degToRad(item.transform.yawDeg);object.scale.fromArray(item.transform.scale);
    }else object.position.fromArray(item.position);
    object.name=item.id;candidate.root.add(object);
    if(item.kind==='model'&&item.speakerUserId){
     candidate.speakers.push(new MeshSpeechGlow(object,item.speakerUserId));candidate.speakerIds.add(item.speakerUserId);
    }
   }
   signal.throwIfAborted();
   if(version!==this.generation)return;
   const previous=this.active;
   this.root.add(candidate.root);this.active=candidate;committed=true;
   this.revision++;this.recountLights();this.root.updateMatrixWorld(true);
   if(previous)releaseGeneration(previous);
  }catch(error){
   if(version===this.generation&&!signal.aborted)this.error=error instanceof Error?error.message:'STUDIO_LOAD_FAILED';
  }finally{
   if(!committed)releaseGeneration(candidate);
   if(version===this.generation){this.loading=false;this.pending=undefined;}
  }
 }
 setLength(length:number,offsetZ=0):string{
  this.active?.broadcast?.setLength(length,offsetZ);
  const definition=this.active?.definition,overflow=!!definition&&length>definition.tableEnvelope.maxStraightLength;
  this.root.visible=this.active!==null&&!(overflow&&definition?.tableEnvelope.overflow==='hide-studio');
  return this.error?'STUDIO_LOAD_FAILED':this.loading?'STUDIO_LOADING':overflow?'STUDIO_CAPACITY_OVERFLOW':'READY';
 }
 dispose():void{
  if(this.disposed)return;
  this.disposed=true;this.generation++;this.pending?.abort();this.pending=undefined;
  if(this.active)releaseGeneration(this.active);
  this.active=null;this.models.dispose();this.loading=false;this.authoredLights=0;this.root.removeFromParent();
 }
}
