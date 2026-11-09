import * as THREE from 'three';
import {BroadcastDesk} from '../../src/web/studio/broadcast-desk.ts';
import {ExposureRenderer,createFallbackLights,protectDisplayObject} from '../../src/web/studio/exposure-renderer.ts';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';
import {DEFAULT_EXPOSURE} from '../../src/studio/exposure.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';
import {widePose} from '../../src/domain/camera-planner.ts';
import {disposeObject} from '../../src/web/studio/dispose.ts';
import type {SplitPanel} from '../../src/contracts/domain.ts';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')!,alpha:true});
renderer.info.autoReset=false;const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
const device=debug?String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'not-reported';
const percentile=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]!;
(window as any).renderBenchmark=async({count,split,high,frames,width}:{count:number;split:boolean;high:boolean;frames:number;width:number})=>{
 const scene=new THREE.Scene(),layout=makeLayout(count),desk=new BroadcastDesk(layout.straightLength);scene.add(desk);
 for(const seat of layout.seats){const m=new THREE.Mesh(new THREE.CircleGeometry(.28,32),new THREE.MeshBasicMaterial({color:0x6090c0,side:THREE.DoubleSide}));m.position.fromArray(seat.faceAnchor);m.rotation.y=seat.baseYawRad;protectDisplayObject(m);scene.add(m);}
 const lights=createFallbackLights();scene.add(lights);for(let i=0;i<8;i++){const l=new THREE.DirectionalLight(0xffffff,.5);l.position.set(Math.sin(i)*5,6,Math.cos(i)*5);scene.add(l);}
 const camera=new THREE.PerspectiveCamera(45,16/9,.15,1000),pose=widePose(layout.straightLength);
 camera.position.fromArray(pose.position);camera.lookAt(...pose.target);
 const pipeline=new ExposureRenderer(renderer,lights),dual=new SplitRenderer(renderer);
 const q={...DEFAULT_QUALITY,...(high?{shadowSize:2048 as const,renderScale:1.5 as const}:{} )};
 renderer.setPixelRatio(q.renderScale);renderer.setSize(width,width*9/16,false);
 const exposure={...DEFAULT_EXPOSURE,mode:'manual' as const,manualExposure:1,lighting:'studio' as const};
 const panel=(i:number):SplitPanel=>({userId:String(i),pose:{position:[i?3:-3,2.4,6],target:[0,1.1,0],fov:30}});
 const panels:[SplitPanel,SplitPanel]=[panel(0),panel(1)];
 const interval:number[]=[],cpu:number[]=[];let previous=0,calls=0,triangles=0;
 let result:Record<string,unknown>;
 try{
  for(let i=0;i<frames+10;i++){
   const time=await new Promise<number>(resolve=>requestAnimationFrame(resolve));renderer.info.reset();const t=performance.now();
   if(split){pipeline.prepare(scene,camera,exposure,'benchmark',8,time);dual.render(scene,panels,q,DEFAULT_POST,'benchmark', (panel,c)=>{c.position.fromArray(panel.pose.position);c.lookAt(...panel.pose.target);c.fov=panel.pose.fov;c.near=.15;return {distance:6,range:.5};});}
   else pipeline.render(scene,camera,exposure,'benchmark',8,time,q,DEFAULT_POST);
   if(i>=10){interval.push(time-previous);cpu.push(performance.now()-t);calls+=renderer.info.render.calls;triangles+=renderer.info.render.triangles;}previous=time;
  }
  result={count,split,high,width,height:width*9/16,device,software:/swiftshader|llvmpipe|software/i.test(device),frame:{p50Ms:percentile(interval,.5),p95Ms:percentile(interval,.95)},cpuSubmission:{p50Ms:percentile(cpu,.5),p95Ms:percentile(cpu,.95)},drawCalls:calls/frames,triangles:triangles/frames,memory:{...renderer.info.memory}};
 }finally{pipeline.dispose();dual.dispose();disposeObject(scene);}
 return {...result,memoryAfterDispose:{...renderer.info.memory}};
};

(window as any).disposeRenderBenchmark=()=>{
 // Renderer-internal lookup tables are not owned by a scene. Release the
 // renderer/context only after all scenarios have measured the shared baseline.
 renderer.dispose();renderer.forceContextLoss();
 return {contextLost:gl.isContextLost(),reportedMemory:{...renderer.info.memory}};
};
