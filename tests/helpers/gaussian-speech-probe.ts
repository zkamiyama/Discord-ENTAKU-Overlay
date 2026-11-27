import * as THREE from 'three';
import {PackedSplats,SplatMesh,SparkRenderer} from '@sparkjsdev/spark';
import {GaussianRuntime} from '../../src/web/gaussian/runtime.ts';
import {setGaussianSpeechGlow,setGaussianSpeechBounds,fillGaussianSpeechRanges} from '../../src/web/gaussian/speech-glow.ts';
import {GAUSSIAN_COLOR_LAYER} from '../../src/web/studio/gaussian-layers.ts';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {DEFAULT_QUALITY,type QualitySettings} from '../../src/studio/quality.ts';
import {DEFAULT_POST,type PostSettings} from '../../src/studio/post-effects.ts';
import {makeBust} from './gaussian-bust.ts';

const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
renderer.setSize(480,480,false);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(31,1,.05,50);
camera.position.set(.65,1.65,3.9);camera.lookAt(0,1.05,0);camera.layers.enable(1);
const runtime=new GaussianRuntime(renderer,scene),release=runtime.retainVisual();
const packed=await makeBust();await packed.createLodSplats();
const first=new SplatMesh({packedSplats:packed,raycastable:false}),second=new SplatMesh({packedSplats:packed,raycastable:false});
await Promise.all([first.initialized,second.initialized]);
for(const mesh of [first,second]){mesh.layers.set(1);mesh.layers.enable(GAUSSIAN_COLOR_LAYER);scene.add(mesh);}
second.recolor.setRGB(1.15,.76,.58);
for(const mesh of [first,second])setGaussianSpeechBounds(mesh,new THREE.Box3(new THREE.Vector3(-.65,0,-.4),new THREE.Vector3(.65,1.95,.4)));
// A broad, almost 2D human silhouette made of spherical splats.
 // Its min/mid scale ratio is 1, so Fresnel-only rim is identically zero.
 const flatPacked=new PackedSplats({construct(data){
  for(let yi=0;yi<74;yi++)for(let xi=-42;xi<=42;xi++){
   const x=xi*.023,y=yi*.023;
   const head=(x/.235)**2+((y-1.42)/.29)**2<1;
   const torso=Math.abs(x)<.34&&y>=.42&&y<=1.20;
   const arms=Math.abs(x)<.97&&y>=1.035&&y<=1.14;
   const legs=(Math.abs(x-.16)<.095||Math.abs(x+.16)<.095)&&y>=.02&&y<.43;
   if(!head&&!torso&&!arms&&!legs)continue;
   data.pushSplat(new THREE.Vector3(x,y,0),new THREE.Vector3(.026,.026,.026),
    new THREE.Quaternion(),.95,new THREE.Color(.84,.76,.67));
  }
 }});
 await flatPacked.initialized;await flatPacked.createLodSplats();
 const flat=new SplatMesh({packedSplats:flatPacked,raycastable:false});
 await flat.initialized;flat.layers.set(1);flat.layers.enable(GAUSSIAN_COLOR_LAYER);
 flat.visible=false;scene.add(flat);
setGaussianSpeechBounds(flat,new THREE.Box3(new THREE.Vector3(-1.01,0,-.04),new THREE.Vector3(1.01,1.74,.04)));
const table=new THREE.Mesh(new THREE.BoxGeometry(2.6,.09,.85),new THREE.MeshStandardMaterial({color:0x66544b,roughness:.5}));table.position.set(0,.47,.5);table.userData.entakuReflective=true;scene.add(table);
const blocker=new THREE.Mesh(new THREE.BoxGeometry(.25,2,.2),new THREE.MeshStandardMaterial({color:0x737d8a}));blocker.position.set(-.06,1,.85);scene.add(blocker);
scene.add(new THREE.HemisphereLight(0xffffff,0x333333,1.5));
const quality=new QualityRenderer(renderer),split=new SplitRenderer(renderer);
let width=480,height=480,serial=0,options:Options={},q:QualitySettings,p:PostSettings;
type Options={mode?:0|1|2;speaking?:'first'|'second'|'both'|'none';layout?:'single'|'overlap'|'apart'|'hidden'|'blocker'|'planar';background?:boolean;split?:boolean;swap?:boolean;width?:number;height?:number;budget?:number;glowScale?:number;secondaryGlowScale?:number;secondaryStrength?:number;cameraDistance?:number;startupMotion?:boolean;post?:Partial<PostSettings>;quality?:Partial<QualitySettings>};
type Draw={camera:string;ranges:number[][];expected:number[][]};
let draws:Draw[]=[];
let drawLimits=new Map<string,{camera:string;draws:number;maximumSplats:number;maximumExcess:number}>();
function recordDraw(node:SparkRenderer){
 node.onAfterRender=(_r,_s,c)=>{
  // Test-only introspection of the real runtime; the draw node must use the
  // current camera's display mapping after native Spark onBeforeRender.
  const view=(runtime as unknown as {views:Map<THREE.Camera,SparkRenderer>}).views.get(c)!;
  const splats=(node.geometry as THREE.InstancedBufferGeometry).instanceCount;
  const limit=drawLimits.get(c.uuid)??{camera:c.uuid,draws:0,maximumSplats:0,maximumExcess:0};
  limit.draws++;limit.maximumSplats=Math.max(limit.maximumSplats,splats);limit.maximumExcess=Math.max(limit.maximumExcess,splats-(view.lodSplatCount??0));drawLimits.set(c.uuid,limit);
  const expected=Array.from({length:32},()=>new THREE.Vector4());fillGaussianSpeechRanges(view.display.mapping,expected,c,view.renderSize.y);
  draws.push({camera:c.uuid,ranges:node.material.uniforms.speakerRanges!.value.map((v:THREE.Vector4)=>v.toArray()),expected:expected.map(v=>v.toArray())});
 };
}
function draw(){
 draws=[];
 for(const node of scene.children)if(node instanceof SparkRenderer){node.material.uniforms.rimMode!.value=options.mode??2;recordDraw(node);}
 if(options.split){
  const sign=options.swap?-1:1;
  split.render(scene,[{userId:'first',pose:{position:[.65,1.65,sign*3.9],target:[0,1.05,0],fov:38}},{userId:'second',pose:{position:[-.65,1.65,-sign*3.9],target:[0,1.05,0],fov:38}}],q,p,String(serial),(panel,view)=>{
   view.position.fromArray(panel.pose.position);view.lookAt(new THREE.Vector3().fromArray(panel.pose.target));
   view.fov=panel.pose.fov;view.near=.05;view.far=50;
   return {distance:4,range:.5};
  });
 }else quality.render(scene,camera,q,String(serial),p,{distance:4,range:.5});
}
async function settle(next:Options={}){
 const started=performance.now();
 console.info('ENTAKU_SPEECH_SETTLE_START '+JSON.stringify(next));
 options=next;serial++;drawLimits=new Map();scene.background=next.background?new THREE.Color(0x15273b):null;width=next.width??480;height=next.height??480;renderer.setSize(width,height,false);camera.aspect=width/height;camera.position.set(.65,1.65,next.cameraDistance??3.9);camera.lookAt(0,1.05,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const flatMode=next.layout==='planar';flat.visible=flatMode;first.visible=!flatMode;
 second.visible=next.layout==='overlap'||next.layout==='apart';
 first.position.set(next.layout==='apart'?-1.1:second.visible?-.16:0,0,next.layout==='apart'?0:second.visible?-.18:0);
 second.position.set(next.layout==='apart'?1.1:.36,-.03,next.layout==='apart'?0:.39);second.rotation.y=-.12;
 blocker.visible=next.layout==='hidden'||next.layout==='blocker';blocker.scale.x=next.layout==='hidden'?12:1;
 const speaker=next.speaking??'first';setGaussianSpeechGlow(first,!flatMode&&(speaker==='first'||speaker==='both')?1:0,next.glowScale??4);setGaussianSpeechGlow(second,speaker==='second'||speaker==='both'?next.secondaryStrength??1:0,next.secondaryGlowScale??next.glowScale??4);
 setGaussianSpeechGlow(flat,flatMode&&(speaker==='first'||speaker==='both')?1:0,next.glowScale??4);
 runtime.setBudget(next.budget??80000,next.split?2:1);
 q={...DEFAULT_QUALITY,shadows:'off',ao:'off',reflections:false,fxaa:false,msaa:0,...next.quality};p={...DEFAULT_POST,enabled:false,...next.post};
 let consecutive=0,previous='';
 for(let i=0;i<120;i++){
  await new Promise(requestAnimationFrame);draw();
  if(next.startupMotion&&i===0){camera.position.x+=.0005;camera.rotateY(.004);camera.updateMatrixWorld(true);}
  const state=runtime.diagnostics(),active=state.views.filter(v=>v.active);
  const signature=JSON.stringify(active.map(v=>[v.selectedSplats,v.displayedLodInstances]));
  const ready=i>=10&&active.length===(next.split?2:1)&&active.every(v=>v.ready&&v.lodMatchesView&&v.selectedSplats>0&&v.selectedSplats<=v.budget!&&v.lodInstances.every((n,j)=>n===v.displayedLodInstances[j]));
  consecutive=ready&&signature===previous?consecutive+1:0;previous=signature;
  if(consecutive>=3){
   console.info('ENTAKU_SPEECH_SETTLE_END '+JSON.stringify({options:next,frames:i+1,elapsedMs:Math.round(performance.now()-started)}));
   return status();
  }
  if(i%20===19)console.info('ENTAKU_SPEECH_SETTLE_PROGRESS '+JSON.stringify({options:next,frames:i+1,elapsedMs:Math.round(performance.now()-started),active:active.map(v=>({selected:v.selectedSplats,matches:v.lodMatchesView,pending:v.lodPending}))}));
 }
 throw new Error('SPEECH_LOD_NOT_SETTLED '+JSON.stringify(status()));
}
const saved=new Map<string,Uint8Array>();
function pixels(){const gl=renderer.getContext(),data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
function save(name:string){saved.set(name,pixels());return status();}
function compare(a:string,b:string){const x=saved.get(a)!,y=saved.get(b)!;if(x.length!==y.length)throw new Error('SIZE_MISMATCH');let changed=0,max=0,green=0;for(let i=0;i<x.length;i+=4){const d=Math.max(Math.abs(x[i]!-y[i]!),Math.abs(x[i+1]!-y[i+1]!),Math.abs(x[i+2]!-y[i+2]!));if(d>3)changed++;max=Math.max(max,d);green+=y[i+1]!-x[i+1]!;}return {changed,max,green};}
function compareColumns(a:string,b:string,start:number,end:number){
 const x=saved.get(a)!,y=saved.get(b)!;let changed=0,max=0,green=0;
 for(let row=0;row<height;row++)for(let column=start;column<end;column++){
  const i=(row*width+column)*4,d=Math.max(...[0,1,2,3].map(channel=>Math.abs(x[i+channel]!-y[i+channel]!)));
  if(d>3)changed++;max=Math.max(max,d);green+=y[i+1]!-x[i+1]!;
 }
 return {changed,max,green};
}
function savedPixel(name:string,x:number,y:number){const data=saved.get(name)!;return Array.from(data.subarray((y*width+x)*4,(y*width+x)*4+4));}
function haloOutside(a:string,b:string){
 const x=saved.get(a)!,y=saved.get(b)!;let count=0,green=0,transparent=0,dark=0,maxOutsideGreen=0;
 for(let i=0;i<x.length;i+=4){
  if(x[i+3]!<8)transparent++;
  const background=x[i]!<10&&x[i+1]!<10&&x[i+2]!<10;
  if(background)dark++;
  if(!background)continue;
  maxOutsideGreen=Math.max(maxOutsideGreen,y[i+1]!);
  if(y[i+1]!>y[i]!*1.3+4&&y[i+1]!>y[i+2]!*1.12+3){count++;green+=y[i+1]!;}
 }
 return {count,green,transparent,dark,maxOutsideGreen};
}
function status(){return {runtime:runtime.diagnostics(),draws,drawLimits:[...drawLimits.values()],width,height,inputSplats:packed.numSplats};}
async function redraw(frames=13){for(let i=0;i<frames;i++){await new Promise(requestAnimationFrame);draw();}return status();}
async function idle(){
 let stable=0;
 for(let frame=0;frame<120;frame++){
  await redraw(1);
  const views=[...(runtime as unknown as {views:Map<THREE.Camera,SparkRenderer>}).views.values()];
  stable=views.every(view=>!view.sorting&&!view.sortDirty&&!view.lodDirty&&view.currentLod===view.lastLod)?stable+1:0;
  if(stable>=3)return status();
 }
 throw new Error('SPEECH_IDLE_NOT_SETTLED');
}
function dispose(){setGaussianSpeechGlow(first,0);setGaussianSpeechGlow(second,0);setGaussianSpeechGlow(flat,0);quality.dispose();split.dispose();release();runtime.dispose();for(const m of [first,second,flat]){m.packedSplats=undefined;m.splats=undefined;m.dispose();}packed.dispose();flatPacked.dispose();table.geometry.dispose();table.material.dispose();blocker.geometry.dispose();blocker.material.dispose();renderer.dispose();}
(window as any).gaussianSpeechProbe={settle,redraw,idle,save,compare,compareColumns,haloOutside,savedPixel,status,dispose};
