import * as THREE from 'three';
import type {AppSnapshot,CameraPose} from '../../contracts/domain.ts';
import type {RenderStatus} from '../../contracts/diagnostics.ts';
import type {MisskeyState} from '../../contracts/misskey.ts';
import {DEFAULT_DIRECTION} from '../../studio/direction.ts';
import {StudioClient} from '../shared/client.ts';
import {BroadcastDesk} from '../studio/broadcast-desk.ts';
import {StudioVisual} from '../studio/visual.ts';
import {disposeObject} from '../studio/dispose.ts';
import {GaussianRuntime} from '../gaussian/runtime.ts';
import {Avatar} from './avatar.ts';
import {AvatarRoster} from './roster.ts';
import {ScenePresentation} from './scene-presentation.ts';
import {cameraPose,sampleSeat,sampleStage,setLocalCamera} from './stage-frame.ts';
import {MisskeyCards} from './misskey-cards.ts';

export interface PreparedFrame {
 state:AppSnapshot|null;pose:CameraPose;length:number;offsetZ:number;near:number;studioStatus:RenderStatus;
}

/** Own the scene graph and project authoritative snapshots into live visuals.
 * Network callbacks do not render; render passes do not own membership. */
export class OverlayScene {
 readonly scene=new THREE.Scene();
 readonly stage=new THREE.Group();
 readonly camera=new THREE.PerspectiveCamera(45,16/9,DEFAULT_DIRECTION.nearClip,1000);
 readonly gaussian:GaussianRuntime;
 readonly studio:StudioVisual;
 readonly roster:AvatarRoster<Avatar>;
 readonly failures=new Set<string>();
 readonly table=new BroadcastDesk(0);
 readonly misskey=new MisskeyCards();
 state:AppSnapshot|null=null;
 private readonly presentation=new ScenePresentation();
 get presentedState():AppSnapshot|null{return this.presentation.resolve(this.state,this.studio.definition);}
 private lastLength=-1;
 private readonly worldTarget=new THREE.Vector3();
 private readonly meshVoices=new Map<string,{visible:boolean;opacity:number;intensity:number}>();
 private stopped=false;

 constructor(client:StudioClient,renderer:THREE.WebGLRenderer){
  this.scene.add(this.stage);this.stage.add(this.table,this.misskey.root);
  this.gaussian=new GaussianRuntime(renderer,this.scene);
  this.studio=new StudioVisual(client,renderer);this.scene.add(this.studio.root);
  this.roster=new AvatarRoster((person,profile)=>new Avatar({
   client,stage:this.stage,camera:this.camera,gaussian:this.gaussian,failures:this.failures,state:()=>this.presentedState,
  },person,profile));
 }
 setMisskey(state:MisskeyState|null):void{if(!this.stopped)this.misskey.setState(state);}
 apply(next:AppSnapshot):void{
  if(this.stopped)return;
  const previous=this.state;this.state=next;
  if(!previous||previous.studio!==next.studio)void this.studio.update(next.studio);
  if(!previous||previous.serverEpoch!==next.serverEpoch||previous.participants!==next.participants||previous.session!==next.session||previous.avatarProfiles!==next.avatarProfiles||previous.studio.quality?.nameplates!==next.studio.quality?.nameplates)this.roster.sync(next);
 }
 prepare(now:number,time:number,dt:number,connected:boolean):PreparedFrame{
  if(connected)this.studio.retry();
  const state=this.presentedState,{length,offsetZ,progress}=sampleStage(state,now),motion=state?.layoutMotion;
  if(Math.abs(length-this.lastLength)>.00001){this.table.update(length);this.lastLength=length;}
  this.table.position.z=offsetZ;
  this.misskey.prepare(length,offsetZ,connected&&!!state);
  const pose=cameraPose(state,now,connected&&this.studio.readyForCamera);
  const near=state?.studio.direction?.nearClip??DEFAULT_DIRECTION.nearClip;
  setLocalCamera(this.camera,pose,near);
  let studioStatus:RenderStatus='STATE_WAITING';
  if(state){
   for(const reservation of state.session.reservations){
    const target=state.seats[reservation.slotIndex],avatar=this.roster.avatars.get(reservation.userId);
    if(target&&avatar)avatar.render(sampleSeat(target,motion?.fromSeats[reservation.slotIndex],progress),dt,time,connected&&state.connection==='ready');
   }
   this.roster.pruneFaded();
   this.stage.position.fromArray(state.studio.tableAnchor.position);
   this.stage.rotation.y=THREE.MathUtils.degToRad(state.studio.tableAnchor.yawDeg);
   this.stage.updateMatrixWorld(true);
   this.worldTarget.fromArray(pose.target).applyMatrix4(this.stage.matrixWorld);
   this.camera.position.applyMatrix4(this.stage.matrixWorld);this.camera.lookAt(this.worldTarget);
   studioStatus=this.studio.setLength(length,offsetZ);
   if(!connected||state.camera.studioHidden)this.studio.root.visible=false;
   if(state.camera.studioHidden)studioStatus='CAMERA_SAFE_FALLBACK';
   if(!connected)studioStatus='STATE_STALE';
   // One voice state is sampled for all body implementations; meshes use
   // the same smooth fade and speech envelope as images and Gaussian bodies.
   this.meshVoices.clear();
   for(const [id,avatar] of this.roster.avatars){
    const eligible=avatar.user.presence!=='absent'&&avatar.opacity>.005;
    const hasMesh=eligible&&this.studio.hasMeshSpeaker(id);
    avatar.setMeshBodyActive(hasMesh);
    if(hasMesh)this.meshVoices.set(id,{visible:true,opacity:avatar.opacity,intensity:avatar.speechIntensity});
   }
   if(this.studio.meshSpeechCount)this.studio.setMeshSpeech(this.meshVoices,state.studio.post?.speechGlowScale??4);
  }
  return {state,pose,length,offsetZ,near,studioStatus};
 }
 dispose():void{
  if(this.stopped)return;
  this.stopped=true;this.roster.dispose();this.misskey.dispose();this.gaussian.dispose();this.studio.dispose();disposeObject(this.table);this.scene.clear();
  this.state=null;this.presentation.clear();this.meshVoices.clear();this.failures.clear();
 }
}
