import * as THREE from 'three';
import {MeshSpeechGlow} from '../../src/web/studio/mesh-speech.ts';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';

const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true,preserveDrawingBuffer:true});
renderer.setSize(600,600,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setClearColor(0x121c2c,1);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1,.05,50);
camera.position.set(.65,1.55,4.5);camera.lookAt(0,1.05,0);camera.layers.enable(1);camera.updateMatrixWorld(true);
const model=new THREE.Group();
function piece(geom:THREE.BufferGeometry,color:number,x:number,y:number,z:number){
 const mesh=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({color,roughness:.85}));mesh.position.set(x,y,z);model.add(mesh);return mesh;
}
// Exercise the same skin/morph shader path used by character GLBs.
const headGeometry=new THREE.SphereGeometry(.26,20,15);
const vertexCount=headGeometry.getAttribute('position')!.count;
const indices=new Uint16Array(vertexCount*4),weights=new Float32Array(vertexCount*4);
for(let i=0;i<vertexCount;i++)weights[i*4]=1;
headGeometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
headGeometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
const headBone=new THREE.Bone();const head=new THREE.SkinnedMesh(headGeometry,new THREE.MeshStandardMaterial({color:0xefc9b0,roughness:.85}));
head.position.set(0,1.54,0);head.add(headBone);head.bind(new THREE.Skeleton([headBone]));model.add(head);
piece(new THREE.BoxGeometry(.64,.74,.30),0x5772a4,0,.92,0);
piece(new THREE.CapsuleGeometry(.085,.64,4,10),0x5978a7,-.42,.93,.02).rotation.z=-.22;
piece(new THREE.CapsuleGeometry(.085,.64,4,10),0x5978a7,.42,.93,.02).rotation.z=.22;
piece(new THREE.CapsuleGeometry(.09,.62,4,10),0x2b3d5c,-.19,.25,0);
piece(new THREE.CapsuleGeometry(.09,.62,4,10),0x2b3d5c,.19,.25,0);
scene.add(model);
const effect=new MeshSpeechGlow(model,'100');
const table=piece(new THREE.BoxGeometry(2.8,.11,.6),0x776551,0,.49,.62);
model.remove(table);scene.add(table);
const blocker=piece(new THREE.BoxGeometry(.3,2,.3),0x808e9e,0,1,.89);
model.remove(blocker);scene.add(blocker);blocker.visible=false;
scene.add(new THREE.HemisphereLight(0xffffff,0x4b4b69,2));
const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(-3,4,4);scene.add(key);
const quality=new QualityRenderer(renderer),split=new SplitRenderer(renderer);
let width=600,height=600,serial=0,options:Options={};
type Options={width?:number;height?:number;distance?:number;strength?:number;scale?:number;blocker?:boolean;split?:boolean;post?:boolean};
function draw(){
 const q={...DEFAULT_QUALITY,shadows:'off' as const,ao:'off' as const,reflections:false,gi:'off' as const,msaa:0 as const,fxaa:false};
 const p={...DEFAULT_POST,enabled:!!options.post,excludeAvatars:true,saturation:1.05,contrast:1.03};
 if(options.split)split.render(scene,[
  {userId:'100',pose:{position:[.65,1.55,options.distance??4.5] as [number,number,number],target:[0,1.05,0] as [number,number,number],fov:37}},
  {userId:'101',pose:{position:[-.65,1.55,-(options.distance??4.5)] as [number,number,number],target:[0,1.05,0] as [number,number,number],fov:37}}
 ],q,p,String(serial),(panel,panelCamera)=>{
  panelCamera.position.fromArray(panel.pose.position);panelCamera.lookAt(...panel.pose.target);
  panelCamera.fov=panel.pose.fov;panelCamera.layers.enable(1);panelCamera.updateMatrixWorld(true);
  return {distance:4,range:.5};
 });
 else quality.render(scene,camera,q,String(serial),p,{distance:4,range:.5});
}
async function settle(next:Options){
 options=next;serial++;width=next.width??600;height=next.height??600;
 renderer.setSize(width,height,false);camera.aspect=width/height;camera.position.set(.65,1.55,next.distance??4.5);camera.lookAt(0,1.05,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 effect.setPresence(1);effect.setSpeech(next.strength??1,next.scale??4);blocker.visible=!!next.blocker;
 for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);draw();}
 return status();
}
function pixels(){
 const data=new Uint8Array(width*height*4),gl=renderer.getContext();
 gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;
}
const saved=new Map<string,Uint8Array>();
function save(label:string){saved.set(label,pixels());}
function compare(a:string,b:string){
 const x=saved.get(a)!,y=saved.get(b)!;let changed=0,green=0,max=0,visibleRim=0;
 for(let i=0;i<x.length;i+=4){
  const diff=Math.max(...[0,1,2].map(k=>Math.abs(x[i+k]!-y[i+k]!)));
  if(diff>4)changed++;green+=y[i+1]!-x[i+1]!;max=Math.max(max,diff);
  if(x[i]!==undefined&&x[i+1]!<x[i]!+3&&y[i+1]!>y[i]!+5)visibleRim++;
 }
 return {changed,green,max,visibleRim};
}
function status(){
 const target=renderer.getRenderTarget(),size=target?new THREE.Vector2(target.width,target.height):renderer.getDrawingBufferSize(new THREE.Vector2());
 return {width,height,size:size.toArray(),hulls:effect.hullCount,active:effect.active,error:renderer.getContext().getError()};
}
function dispose(){effect.dispose();quality.dispose();split.dispose();for(const o of scene.children)if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}for(const m of model.children)if(m instanceof THREE.Mesh){m.geometry.dispose();m.material.dispose();}renderer.dispose();}
(window as any).meshSpeechProbe={settle,save,compare,status,dispose};
