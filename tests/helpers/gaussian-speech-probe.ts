import * as THREE from 'three';
import {SplatMesh,SparkRenderer} from '@sparkjsdev/spark';
import {GaussianRuntime} from '../../src/web/gaussian/runtime.ts';
import {setGaussianSpeechGlow,fillGaussianSpeechRanges} from '../../src/web/gaussian/speech-glow.ts';
import {GAUSSIAN_COLOR_LAYER} from '../../src/web/studio/gaussian-layers.ts';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {DEFAULT_QUALITY,type QualitySettings} from '../../src/studio/quality.ts';
import {DEFAULT_POST,type PostSettings} from '../../src/studio/post-effects.ts';
import {makeBust} from '../../experiments/gaussian-fresnel-preview/fixture.ts';

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
const table=new THREE.Mesh(new THREE.BoxGeometry(2.6,.09,.85),new THREE.MeshStandardMaterial({color:0x66544b,roughness:.5}));table.position.set(0,.47,.5);table.userData.entakuReflective=true;scene.add(table);
const blocker=new THREE.Mesh(new THREE.BoxGeometry(.25,2,.2),new THREE.MeshStandardMaterial({color:0x737d8a}));blocker.position.set(-.06,1,.85);scene.add(blocker);
scene.add(new THREE.HemisphereLight(0xffffff,0x333333,1.5));
const quality=new QualityRenderer(renderer),split=new SplitRenderer(renderer);
let width=480,height=480,serial=0,options:Options={},q:QualitySettings,p:PostSettings;
type Options={mode?:0|1|2;speaking?:'first'|'second'|'both'|'none';layout?:'single'|'overlap'|'hidden'|'blocker';split?:boolean;swap?:boolean;width?:number;height?:number;budget?:number;glowScale?:number;post?:Partial<PostSettings>;quality?:Partial<QualitySettings>};
type Draw={camera:string;ranges:number[][];expected:number[][]};
let draws:Draw[]=[];
function recordDraw(node:SparkRenderer){
 node.onAfterRender=(_r,_s,c)=>{
  // Test-only introspection of the real runtime; the draw node must use the
  // current camera's display mapping after native Spark onBeforeRender.
  const view=(runtime as unknown as {views:Map<THREE.Camera,SparkRenderer>}).views.get(c)!;
  const expected=Array.from({length:32},()=>new THREE.Vector4());fillGaussianSpeechRanges(view.display.mapping,expected);
  draws.push({camera:c.uuid,ranges:node.material.uniforms.speakerRanges!.value.map((v:THREE.Vector4)=>v.toArray()),expected:expected.map(v=>v.toArray())});
 };
}
function draw(){
 draws=[];
 for(const node of scene.children)if(node instanceof SparkRenderer){node.material.uniforms.rimMode!.value=options.mode??2;recordDraw(node);}
 if(options.split){
  const sign=options.swap?-1:1;
  split.render(scene,[{userId:'first',pose:{position:[.65,1.65,sign*3.9],target:[0,1.05,0],fov:38}},{userId:'second',pose:{position:[-.65,1.65,-sign*3.9],target:[0,1.05,0],fov:38}}],q,p,String(serial),()=>({distance:4,range:.5}));
 }else quality.render(scene,camera,q,String(serial),p,{distance:4,range:.5});
}
async function settle(next:Options={}){
 options=next;serial++;width=next.width??480;height=next.height??480;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
 second.visible=next.layout==='overlap';first.position.set(second.visible?-.16:0,0,second.visible?-.18:0);second.position.set(.36,-.03,.39);second.rotation.y=-.12;
 blocker.visible=next.layout==='hidden'||next.layout==='blocker';blocker.scale.x=next.layout==='hidden'?12:1;
 const speaker=next.speaking??'first';setGaussianSpeechGlow(first,speaker==='first'||speaker==='both'?1:0,next.glowScale??4);setGaussianSpeechGlow(second,speaker==='second'||speaker==='both'?1:0,next.glowScale??4);
 runtime.setBudget(next.budget??80000,next.split?2:1);
 q={...DEFAULT_QUALITY,shadows:'off',ao:'off',reflections:false,fxaa:false,msaa:0,...next.quality};p={...DEFAULT_POST,enabled:false,...next.post};
 let consecutive=0,previous='';
 for(let i=0;i<120;i++){
  await new Promise(requestAnimationFrame);draw();
  const state=runtime.diagnostics(),active=state.views.filter(v=>v.active);
  const signature=JSON.stringify(active.map(v=>[v.selectedSplats,v.displayedLodInstances]));
  const ready=i>=10&&active.length===(next.split?2:1)&&active.every(v=>v.lodMatchesView&&v.selectedSplats>0&&v.lodInstances.every((n,j)=>n===v.displayedLodInstances[j]));
  consecutive=ready&&signature===previous?consecutive+1:0;previous=signature;
  if(consecutive>=3)return status();
 }
 throw new Error('SPEECH_LOD_NOT_SETTLED '+JSON.stringify(status()));
}
const saved=new Map<string,Uint8Array>();
function pixels(){const gl=renderer.getContext(),data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
function save(name:string){saved.set(name,pixels());return status();}
function compare(a:string,b:string){const x=saved.get(a)!,y=saved.get(b)!;if(x.length!==y.length)throw new Error('SIZE_MISMATCH');let changed=0,max=0,green=0;for(let i=0;i<x.length;i+=4){const d=Math.max(Math.abs(x[i]!-y[i]!),Math.abs(x[i+1]!-y[i+1]!),Math.abs(x[i+2]!-y[i+2]!));if(d>3)changed++;max=Math.max(max,d);green+=y[i+1]!-x[i+1]!;}return {changed,max,green};}
function status(){return {runtime:runtime.diagnostics(),draws,width,height,inputSplats:packed.numSplats};}
function dispose(){setGaussianSpeechGlow(first,0);setGaussianSpeechGlow(second,0);quality.dispose();split.dispose();release();runtime.dispose();for(const m of [first,second]){m.packedSplats=undefined;m.splats=undefined;m.dispose();}packed.dispose();table.geometry.dispose();table.material.dispose();blocker.geometry.dispose();blocker.material.dispose();renderer.dispose();}
(window as any).gaussianSpeechProbe={settle,save,compare,status,dispose};
