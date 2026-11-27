import * as THREE from 'three';
import {ProgramRenderer} from './program-renderer.ts';
import {OverlayScene} from './scene.ts';
import {StudioClient} from '../shared/client.ts';
import type {GaussianRuntime} from '../gaussian/runtime.ts';

const client=new StudioClient();
const canvas=document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.info.autoReset=false;
const world=new OverlayScene(client,renderer);
const program=new ProgramRenderer(renderer,world.scene,world.stage,world.camera,world.roster.avatars,world.gaussian);
(window as unknown as {entakuGaussianDiagnostics:()=>ReturnType<GaussianRuntime['diagnostics']>}).entakuGaussianDiagnostics=()=>world.gaussian.diagnostics();
client.onState=next=>world.apply(next);

let contextLost=false,disposed=false,frameId=0;
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;});
canvas.addEventListener('webglcontextrestored',()=>{if(!disposed)location.reload();});
let lastPixelRatio=0,lastWidth=0,lastHeight=0;
function resize():void{
 const width=Math.max(1,Math.min(innerWidth,innerHeight*16/9)),height=width*9/16;
 const ratio=Math.min(Math.min(devicePixelRatio,1.5)*(world.state?.studio.quality?.renderScale??1),4096/width,2304/height);
 if(width===lastWidth&&height===lastHeight&&ratio===lastPixelRatio)return;
 if(ratio!==lastPixelRatio)renderer.setPixelRatio(ratio);
 renderer.setSize(width,height);lastWidth=width;lastHeight=height;lastPixelRatio=ratio;
}
window.addEventListener('resize',resize);resize();
/** DOM telemetry is an observation of rendering, not another state owner. */
function publish(values:Record<string,string>):void{
 for(const [key,value] of Object.entries(values))if(canvas.dataset[key]!==value)canvas.dataset[key]=value;
}
let previous=performance.now(),reportAt=0,frameMs=16.7,nextDetailedStatus=0;
function frame(time:number):void{
 if(disposed)return;
 frameId=requestAnimationFrame(frame);
 const delta=Math.max(0,time-previous);previous=time;
 frameMs=frameMs*.9+Math.min(1000,delta)*.1;
 if(!contextLost){
  resize();renderer.info.reset();
  const state=world.state,prepared=world.prepare(client.now(),time,Math.min(delta/1000,.05),client.connected);
  const {pose,length,offsetZ,near,studioStatus}=prepared;
  const debug=program.render(state,pose,world.studio,client.connected,time,length,offsetZ,near);
  const summary=world.gaussian.frameSummary();
  publish({...debug,cameraNear:String(near),studioStatus,gaussianInstances:String(summary.instances),
   gaussianAssets:String(summary.assets),gaussianSelectedSplats:String(summary.selectedSplats),
   meshSpeakerCount:String(world.studio.meshSpeechCount),meshSpeaking:String(world.studio.activeMeshSpeakers)});
  if(state)publish({studioRevision:String(state.studio.revision),composition:state.camera.composition??state.camera.shot.kind,
   transition:state.camera.transition,straightLength:String(length),deskOffsetZ:String(offsetZ),cameraPosition:world.camera.position.toArray().join(','),
   cameraLocalPosition:pose.position.join(','),cameraLocalTarget:pose.target.join(',')});
  if(time>=nextDetailedStatus){
   nextDetailedStatus=time+100;
   publish({gaussianStatus:JSON.stringify([...world.roster.avatars.values()].filter(a=>a.gaussian).map(a=>({userId:a.user.userId,...a.gaussian!.status})))});
  }
 }
 if(time-reportAt>=1000){
  reportAt=time;client.reportRender(contextLost?'WEBGL_CONTEXT_LOST':world.failures.size?'CUSTOM_AVATAR_UNAVAILABLE':canvas.dataset.studioStatus??'READY',frameMs,renderer.info.render.calls,renderer.info.render.triangles,program.report);
 }
}
frameId=requestAnimationFrame(frame);client.connect();
window.addEventListener('pagehide',()=>{
 disposed=true;cancelAnimationFrame(frameId);window.removeEventListener('resize',resize);client.disconnect();
 program.dispose();world.dispose();renderer.dispose();renderer.forceContextLoss();
},{once:true});
