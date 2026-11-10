import * as THREE from 'three';
import {SplatMesh,type PackedSplats} from '@sparkjsdev/spark';
import {GaussianRuntime} from '../../src/web/gaussian/runtime.ts';
import {GaussianSurface,nativeSurfaceDiagnostics} from '../../src/web/gaussian/surface.ts';
import {GAUSSIAN_COLOR_LAYER} from '../../src/web/studio/gaussian-layers.ts';
import {setGaussianSpeechGlow} from '../../src/web/gaussian/speech-glow.ts';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';
import {makeBust} from '../../experiments/gaussian-fresnel-preview/fixture.ts';
const canvas=document.querySelector('canvas')!,renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(1280,720,false);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,16/9,.05,100);camera.layers.enable(1);
const runtime=new GaussianRuntime(renderer,scene),quality=new QualityRenderer(renderer),split=new SplitRenderer(renderer);
const sources:PackedSplats[]=[],members: {root:THREE.Group;mesh:SplatMesh;surface:GaussianSurface;release:()=>void}[]=[];
const loadStarted=performance.now();
for(let i=0;i<8;i++){
 const hue=new THREE.Color().setHSL(i/8,.5,.45);const packed=await makeBust([hue.r,hue.g,hue.b]);
 // Distinct sources: change shape, scale and color, not eight placements of
 // the same PackedSplats. Synthetic surface-aligned normals are best-case.
 packed.forEachSplat((index,p,s,q,a,c)=>{p.y*=1+i*.015;p.x*=1+i*.01;s.multiplyScalar(1+i*.01);packed.setSplat(index,p,s,q,a,c);});
 await packed.createLodSplats();sources.push(packed);
 const mesh=new SplatMesh({packedSplats:packed,raycastable:false});await mesh.initialized;
 mesh.layers.set(1);mesh.layers.enable(GAUSSIAN_COLOR_LAYER);mesh.userData.entakuGaussianInstance=true;
 const surface=new GaussianSurface(packed),root=new THREE.Group();root.add(mesh,surface);scene.add(root);members.push({root,mesh,surface,release:runtime.retainVisual()});
}
const preparationMs=performance.now()-loadStarted;
const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x555b68,roughness:.18,metalness:.5}));floor.rotation.x=-Math.PI/2;floor.userData.entakuReflective=true;scene.add(floor);
const table=new THREE.Mesh(new THREE.BoxGeometry(6,.12,1.7),new THREE.MeshStandardMaterial({color:0x756253,roughness:.2,metalness:.3}));table.position.set(0,.4,.35);table.userData.entakuReflective=true;scene.add(table);
scene.add(new THREE.HemisphereLight(0xffffff,0x252c3a,.7));
const lights:THREE.DirectionalLight[]=[];
for(let i=0;i<8;i++){const l=new THREE.DirectionalLight(0xffffff,i===0?2:.25);l.position.set(5*Math.cos(i*Math.PI/4),5,5*Math.sin(i*Math.PI/4));l.shadow.camera.left=l.shadow.camera.bottom=-7;l.shadow.camera.right=l.shadow.camera.top=7;l.shadow.camera.far=40;lights.push(l);scene.add(l,l.target);}
let serial=0;
type Options={count:1|8;native:boolean;ssr:boolean;shadows:boolean;split:boolean;width?:number;height?:number;moving?:boolean;lights?:1|8;samples?:number};
function configure(o:Options){
 serial++;const w=o.width??1280,h=o.height??720;renderer.setSize(w,h,false);camera.aspect=w/h;
 camera.position.set(o.count===1?.5:1,2.3,o.count===1?4.5:9);camera.lookAt(0,.9,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 for(let i=0;i<members.length;i++){const m=members[i]!;m.root.visible=i<o.count;m.root.position.set(o.count===1?0:(i%4-1.5)*1.2,0,Math.floor(i/4)*-1.4);m.surface.visible=o.native;setGaussianSpeechGlow(m.mesh,i===0?1:0);}
 runtime.setBudget(500000,o.split?2:1);
}
function draw(o:Options,frame=0){
 if(o.moving)members[0]!.root.position.x=Math.sin(frame*.04)*.35;
 const q={...DEFAULT_QUALITY,shadows:o.shadows?'soft' as const:'off' as const,shadowLights:o.lights??1,shadowSize:1024 as const,ao:'off' as const,reflections:o.ssr,effectsScale:.5 as const,msaa:0 as const,fxaa:false,gi:'off' as const};
 const p={...DEFAULT_POST,enabled:false};
 if(o.split){
  const z=o.count===1?4.5:9;
  split.render(scene,[{userId:'a',pose:{position:[1,2.3,z],target:[0,.9,0],fov:48}},{userId:'b',pose:{position:[-1,2.3,-z],target:[0,.9,0],fov:48}}],q,p,String(serial),(panel,view)=>{view.position.fromArray(panel.pose.position);view.lookAt(new THREE.Vector3().fromArray(panel.pose.target));view.fov=panel.pose.fov;view.near=.05;view.far=100;return {distance:z,range:1};});
 }else quality.render(scene,camera,q,String(serial),p,{distance:9,range:1});
}
const gl=renderer.getContext() as WebGL2RenderingContext,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
const quantile=(values:number[],q:number)=>{const s=values.slice().sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(q*s.length))]:null;};
async function run(options:Options){
 configure(options);for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);draw(options,i);}
 const before=nativeSurfaceDiagnostics(scene),frames:number[]=[],submit:number[]=[],gpu:number[]=[],pending:WebGLQuery[]=[];let disjoint=false,last=performance.now();
 function poll(){
  if(!ext)return;
  if(gl.getParameter(ext.GPU_DISJOINT_EXT))disjoint=true;
  while(pending.length&&gl.getQueryParameter(pending[0]!,gl.QUERY_RESULT_AVAILABLE)){
   const q=pending.shift()!;const ns=gl.getQueryParameter(q,gl.QUERY_RESULT) as number;gl.deleteQuery(q);gpu.push(ns/1e6);
  }
 }
 try{
  for(let i=0;i<(options.samples??90);i++){
   await new Promise(requestAnimationFrame);poll();const now=performance.now();frames.push(now-last);last=now;
   const query=ext?gl.createQuery():null;if(query)gl.beginQuery(ext!.TIME_ELAPSED_EXT,query);
   const cpu=performance.now();try{draw(options,i+40);}finally{submit.push(performance.now()-cpu);if(query){gl.endQuery(ext!.TIME_ELAPSED_EXT);pending.push(query);}}
  }
  for(let i=0;pending.length&&i<120;i++){await new Promise(requestAnimationFrame);poll();}
  const stats=runtime.diagnostics();
  if(options.split){const active=stats.views.filter(v=>v.active);if(active.length!==2||Math.sign(active[0]!.cameraPosition[2]!)!==1||Math.sign(active[1]!.cameraPosition[2]!)!==-1)throw new Error('BENCHMARK_SPLIT_POSE_INVALID');}
  return {options,width:canvas.width,height:canvas.height,dpr:1,preparationMs,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),sourceCounts:sources.slice(0,options.count).map(p=>p.numSplats),sourcePackedBytes:sources.slice(0,options.count).map(p=>p.packedArray?.byteLength??0),frameMs:{p50:quantile(frames,.5),p95:quantile(frames,.95),samples:frames.length},cpuSubmitMs:{p50:quantile(submit,.5),p95:quantile(submit,.95)},gpuMs:!ext||disjoint?null:{p50:quantile(gpu,.5),p95:quantile(gpu,.95),samples:gpu.length},timerDisjoint:disjoint,before,after:nativeSurfaceDiagnostics(scene),runtime:stats,image:canvas.toDataURL('image/png')};
 }finally{for(const q of pending)gl.deleteQuery(q);}
}
function dispose(){quality.dispose();split.dispose();for(const m of members){m.surface.dispose();m.mesh.packedSplats=undefined;m.mesh.dispose();m.release();}runtime.dispose();sources.forEach(p=>p.dispose());for(const o of [floor,table]){o.geometry.dispose();o.material.dispose();}for(const l of lights)l.shadow.dispose();renderer.dispose();}
(window as any).nativeBenchmark={run,dispose,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
