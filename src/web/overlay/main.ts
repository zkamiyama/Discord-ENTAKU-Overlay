import * as THREE from 'three';
import {ProgramRenderer} from './program-renderer.ts';
import {FrameMetrics,GpuFrameSampler} from './frame-metrics.ts';
import {OverlayScene} from './scene.ts';
import {StudioClient} from '../shared/client.ts';
import type {GaussianRuntime} from '../gaussian/runtime.ts';

const client=new StudioClient();
const canvas=document.querySelector<HTMLCanvasElement>('#scene')!;
// World MSAA and final FXAA belong to QualityRenderer. Spark's alpha-blended
// splats do not benefit from multisampling the default framebuffer as well.
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,powerPreference:'high-performance'});
renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.info.autoReset=false;
const world=new OverlayScene(client,renderer);
const metrics=new FrameMetrics(),gpu=new GpuFrameSampler(renderer.getContext() as WebGL2RenderingContext,metrics.gpu);
const program=new ProgramRenderer(renderer,world.scene,world.stage,world.camera,world.roster.avatars,world.gaussian);
(window as unknown as {entakuGaussianDiagnostics:()=>ReturnType<GaussianRuntime['diagnostics']>}).entakuGaussianDiagnostics=()=>world.gaussian.diagnostics();
client.onState=next=>world.apply(next);
client.onMisskey=state=>world.setMisskey(state);client.watchMisskey();

let contextLost=false,disposed=false,frameId=0;
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;});
canvas.addEventListener('webglcontextrestored',()=>{if(!disposed)location.reload();});
let lastPixelRatio=0,lastWidth=0,lastHeight=0;
function resize():void{
 const width=Math.max(1,Math.min(innerWidth,innerHeight*16/9)),height=width*9/16;
 const ratio=Math.min(Math.min(devicePixelRatio,1.5)*(world.presentedState?.studio.quality?.renderScale??1),4096/width,2304/height);
 if(width===lastWidth&&height===lastHeight&&ratio===lastPixelRatio)return;
 if(ratio!==lastPixelRatio)renderer.setPixelRatio(ratio);
 renderer.setSize(width,height);lastWidth=width;lastHeight=height;lastPixelRatio=ratio;
}
window.addEventListener('resize',resize);resize();
/** DOM telemetry is an observation of rendering, not another state owner. */
function publish(values:Record<string,string>):void{
 for(const [key,value] of Object.entries(values))if(canvas.dataset[key]!==value)canvas.dataset[key]=value;
}
let previous=performance.now(),reportAt=0,frameMs=16.7,nextDetailedStatus=0,frameFailed=false,lastFailure=-Infinity;
function frame(time:number):void{
 if(disposed)return;
 frameId=requestAnimationFrame(frame);
 const delta=Math.max(0,time-previous);previous=time;
 frameMs=frameMs*.9+Math.min(1000,delta)*.1;
 if(!contextLost)try{
  const started=performance.now();resize();renderer.info.reset();
  const prepared=world.prepare(client.now(),time,delta/1000,client.connected);
  const {state,pose,length,offsetZ,near,studioStatus}=prepared;
  const prepareMs=performance.now()-started,submittedAt=performance.now();
  gpu.begin(time);
  const debug=(()=>{try{return program.render(state,pose,world.studio,client.connected,time,length,offsetZ,near);}finally{gpu.end();}})();
  metrics.record(delta,prepareMs,performance.now()-submittedAt);frameFailed=false;
  const summary=world.gaussian.frameSummary();
  const cards=world.misskey.stats;
  publish({...debug,cameraNear:String(near),studioStatus,gaussianInstances:String(summary.instances),
   gaussianAssets:String(summary.assets),gaussianSelectedSplats:String(summary.selectedSplats),
   meshSpeakerCount:String(world.studio.meshSpeechCount),meshSpeaking:String(world.studio.activeMeshSpeakers),
   misskeyCards:String(cards.visible),misskeyAllocated:String(cards.allocated),misskeyTextureBytes:String(cards.textureBytes),misskeyTextureUpdates:String(cards.textureUpdates),
   renderCalls:String(renderer.info.render.calls),renderTextures:String(renderer.info.memory.textures)});
  if(state)publish({studioRevision:String(state.studio.revision),composition:state.camera.composition??state.camera.shot.kind,
   transition:state.camera.transition,straightLength:String(length),deskOffsetZ:String(offsetZ),cameraPosition:world.camera.position.toArray().join(','),
   cameraLocalPosition:pose.position.join(','),cameraLocalTarget:pose.target.join(',')});
  if(time>=nextDetailedStatus){
   nextDetailedStatus=time+100;
   publish({gaussianStatus:JSON.stringify([...world.roster.avatars.values()].filter(a=>a.gaussian).map(a=>({userId:a.user.userId,...a.gaussian!.status})))});
  }
 }catch(error){
  frameFailed=true;
  if(time-lastFailure>=1000){lastFailure=time;console.warn('OVERLAY_FRAME_FAILED',error instanceof Error?error.name:'Unknown');}
 }
 if(time-reportAt>=1000){
  reportAt=time;client.reportRender(contextLost?'WEBGL_CONTEXT_LOST':frameFailed?'RENDER_FAILED':world.failures.size?'CUSTOM_AVATAR_UNAVAILABLE':canvas.dataset.studioStatus??'STATE_WAITING',frameMs,renderer.info.render.calls,renderer.info.render.triangles,program.report,metrics.report());
 }
}
frameId=requestAnimationFrame(frame);client.connect();
window.addEventListener('pagehide',()=>{
 disposed=true;cancelAnimationFrame(frameId);window.removeEventListener('resize',resize);client.disconnect();
 gpu.dispose();program.dispose();world.dispose();renderer.dispose();renderer.forceContextLoss();
},{once:true});
