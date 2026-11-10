import {ProgramRenderer} from './program-renderer.ts';
import {sampleStage,sampleSeat,cameraPose,setLocalCamera} from './stage-frame.ts';
import {disposeObject} from '../studio/dispose.ts';
import {Avatar} from './avatar.ts';
import {DEFAULT_DIRECTION} from '../../studio/direction.ts';
import {BroadcastDesk} from '../studio/broadcast-desk.ts';
import { StudioVisual } from '../studio/visual.ts';
import * as THREE from 'three';
import type { AppSnapshot } from '../../contracts/domain.ts';
import { StudioClient } from '../shared/client.ts';
import {GaussianRuntime} from '../gaussian/runtime.ts';
import {DEFAULT_GAUSSIAN_SETTINGS} from '../../assets/gaussian-profile.ts';

const client = new StudioClient();
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
const scene = new THREE.Scene(), stage=new THREE.Group(), camera = new THREE.PerspectiveCamera(45, 16/9, DEFAULT_DIRECTION.nearClip, 1000);
scene.add(stage);
const gaussian=new GaussianRuntime(renderer,scene);
// Diagnostic data is intentionally outside the user-facing editor controls.
(window as unknown as {entakuGaussianDiagnostics:()=>ReturnType<GaussianRuntime['diagnostics']>}).entakuGaussianDiagnostics=()=>gaussian.diagnostics();
const studioVisual=new StudioVisual(client,renderer);scene.add(studioVisual.root);
renderer.info.autoReset=false;
const table=new BroadcastDesk(0);stage.add(table);
const avatarFailures=new Set<string>();
const avatars=new Map<string,Avatar>();let state:AppSnapshot|null=null;
const program=new ProgramRenderer(renderer,scene,stage,camera,avatars);
client.onState=next=>{state=next;void studioVisual.update(next.studio);for(const p of next.participants){const avatar=avatars.get(p.userId);const profile=next.avatarProfiles.find(a=>a.userId===p.userId);if(avatar)avatar.update(p,profile);else avatars.set(p.userId,new Avatar({client,stage,camera,gaussian,failures:avatarFailures,state:()=>state},p,profile));}
  const ids=new Set(next.participants.map(p=>p.userId));for(const [id,avatar]of avatars)if(!ids.has(id)){avatar.dispose();avatars.delete(id);}
};
let previous=performance.now(),lastLength=-1,reportAt=0,frameMs=16.7;
let contextLost=false;canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;});canvas.addEventListener('webglcontextrestored',()=>{location.reload();});
let lastPixelRatio=0;
function resize(){const w=Math.max(1,Math.min(innerWidth,innerHeight*16/9)),h=w*9/16;const requested=Math.min(devicePixelRatio,1.5)*(state?.studio.quality?.renderScale??1);lastPixelRatio=Math.min(requested,4096/w,2304/h);renderer.setPixelRatio(lastPixelRatio);renderer.setSize(w,h);}
window.addEventListener('resize',resize);resize();
function frame(time:number):void{
  if(disposed)return;frameId=requestAnimationFrame(frame);renderer.info.reset();frameMs=frameMs*.9+Math.min(1000,time-previous)*.1;const dt=Math.min((time-previous)/1000,.05);previous=time;
  const requested=Math.min(Math.min(devicePixelRatio,1.5)*(state?.studio.quality?.renderScale??1),4096/Math.max(1,Math.min(innerWidth,innerHeight*16/9)),2304/Math.max(1,Math.min(innerHeight,innerWidth*9/16)));
  if(Math.abs(requested-lastPixelRatio)>.0001)resize();
  const serverNow=client.now(),{length,offsetZ,progress}=sampleStage(state,serverNow),motion=state?.layoutMotion;
  if(Math.abs(length-lastLength)>.00001){table.update(length);lastLength=length;}
  table.position.z=offsetZ;
  const pose=cameraPose(state,serverNow,client.connected&&studioVisual.readyForCamera);
  const near=state?.studio.direction?.nearClip??DEFAULT_DIRECTION.nearClip;
  setLocalCamera(camera,pose,near);canvas.dataset.cameraNear=String(near);
  if(state)for(const reservation of state.session.reservations){
    const target=state.seats[reservation.slotIndex],avatar=avatars.get(reservation.userId);if(!target||!avatar)continue;
    const seat=sampleSeat(target,motion?.fromSeats[reservation.slotIndex],progress);
    avatar.render(seat,dt,time,client.connected&&state.connection==='ready');
  }
  if(state){const assigned=new Set(state.session.reservations.map(r=>r.userId));for(const [id,avatar]of avatars)if(!assigned.has(id)){avatar.root.visible=avatar.plate.visible=false;}}
  if(state){
    stage.position.fromArray(state.studio.tableAnchor.position);stage.rotation.y=THREE.MathUtils.degToRad(state.studio.tableAnchor.yawDeg);stage.updateMatrixWorld(true);
    const target=stage.localToWorld(new THREE.Vector3().fromArray(pose.target));stage.localToWorld(camera.position);camera.lookAt(target);
    const studioStatus=studioVisual.setLength(length,offsetZ);if(!client.connected||state.camera.studioHidden)studioVisual.root.visible=false;canvas.dataset.studioStatus=state.camera.studioHidden?'CAMERA_SAFE_FALLBACK':studioStatus;
    canvas.dataset.studioRevision=String(state.studio.revision);canvas.dataset.composition=state.camera.composition??state.camera.shot.kind;canvas.dataset.transition=state.camera.transition;canvas.dataset.straightLength=String(length);canvas.dataset.deskOffsetZ=String(offsetZ);canvas.dataset.cameraPosition=camera.position.toArray().join(',');canvas.dataset.cameraLocalPosition=pose.position.join(',');canvas.dataset.cameraLocalTarget=pose.target.join(',');
  }
  gaussian.setBudget(state?.studio.gaussian?.lodSplatCount??DEFAULT_GAUSSIAN_SETTINGS.lodSplatCount,state?.camera.shot.kind==='SPLIT'&&!!state.camera.panels&&client.connected&&studioVisual.readyForCamera&&renderer.extensions.has('EXT_color_buffer_float')?2:1);
  if(!contextLost)Object.assign(canvas.dataset,program.render(state,pose,studioVisual,client.connected,time,length,offsetZ,near));
  const gaussianDiagnostics=gaussian.diagnostics();
  canvas.dataset.gaussianInstances=String(gaussianDiagnostics.instances);canvas.dataset.gaussianAssets=String(gaussianDiagnostics.assets.length);
  canvas.dataset.gaussianSelectedSplats=String(gaussianDiagnostics.views.filter(view=>view.active).reduce((sum,view)=>sum+view.selectedSplats,0));
  canvas.dataset.gaussianStatus=JSON.stringify([...avatars.values()].filter(a=>a.gaussian).map(a=>({userId:a.user.userId,...a.gaussian!.status})));
  if(time-reportAt>=1000){reportAt=time;client.reportRender(contextLost?'WEBGL_CONTEXT_LOST':avatarFailures.size?'CUSTOM_AVATAR_UNAVAILABLE':canvas.dataset.studioStatus??'READY',frameMs,renderer.info.render.calls,renderer.info.render.triangles,program.report);}
}
let disposed=false,frameId=requestAnimationFrame(frame);client.connect();
window.addEventListener('pagehide',()=>{
 disposed=true;cancelAnimationFrame(frameId);window.removeEventListener('resize',resize);client.disconnect();
 for(const avatar of avatars.values())avatar.dispose();avatars.clear();
 program.dispose();gaussian.dispose();studioVisual.dispose();disposeObject(table);renderer.dispose();renderer.forceContextLoss();
},{once:true});
