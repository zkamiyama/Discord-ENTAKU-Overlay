import * as THREE from 'three';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_POST,type PostSettings} from '../../src/studio/post-effects.ts';
import {protectDisplayObject} from '../../src/web/studio/exposure-renderer.ts';
import {NameplateVisual} from '../../src/web/studio/nameplate.ts';
import {BroadcastDesk} from '../../src/web/studio/broadcast-desk.ts';
const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(640,360,false);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1;
const effects=new QualityRenderer(renderer),camera=new THREE.PerspectiveCamera(45,16/9,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
const scene=new THREE.Scene();let p:PostSettings={...DEFAULT_POST};
const stripes=document.createElement('canvas');stripes.width=stripes.height=256;const ctx=stripes.getContext('2d')!;for(let x=0;x<256;x+=4){ctx.fillStyle=(x/4)%2?'#999999':'#333333';ctx.fillRect(x,0,4,256);}const texture=new THREE.CanvasTexture(stripes);texture.colorSpace=THREE.SRGBColorSpace;
const background=new THREE.Mesh(new THREE.PlaneGeometry(12,6),new THREE.MeshBasicMaterial({map:texture}));background.position.z=-4;scene.add(background);
const icon=new THREE.Mesh(new THREE.CircleGeometry(.35,64),new THREE.MeshBasicMaterial({color:0xff2255}));icon.position.set(-.7,0,0);protectDisplayObject(icon);scene.add(icon);
const bright=new THREE.Mesh(new THREE.PlaneGeometry(.22,.22),new THREE.MeshBasicMaterial({color:new THREE.Color(20,20,20)}));bright.position.set(.8,.6,0);scene.add(bright);
const front=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.45),new THREE.MeshBasicMaterial({map:texture}));front.position.set(-1.1,.8,0);scene.add(front);
function render(value:Partial<PostSettings>){p={...DEFAULT_POST,saturation:1,contrast:1,...value};camera.layers.enable(1);effects.render(scene,camera,{...DEFAULT_QUALITY,ao:'off',reflections:false,fxaa:false,shadows:'off'},'post-fixture',p,{distance:5,range:.2});return effects.status;}
function capture(){const gl=renderer.getContext(),data=new Uint8Array(640*360*4);gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data];}
function pixel(point:[number,number,number]){const v=new THREE.Vector3().fromArray(point).project(camera),gl=renderer.getContext(),data=new Uint8Array(4);gl.readPixels(Math.floor((v.x+1)*320),Math.floor((v.y+1)*180),1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data];}
function stripeContrast(frontPlane=false){const data=capture();const row=frontPlane?250:300;let total=0;const from=frontPlane?190:290,to=frontPlane?250:420;for(let x=from;x<to;x++){const i=(row*640+x)*4;total+=Math.abs(data[i]!-data[i+4]!);}return total;}
(window as any).postProbe={render,capture,pixel,stripeContrast,memory:()=>({...renderer.info.memory}),setBright(value:boolean){bright.visible=value;},name(name:string){const n=new NameplateVisual(name);return n.userData.textLayout;},desk(){const d=new BroadcastDesk(3),top=d.children.find(o=>o.userData.entakuWoodTop) as THREE.Mesh<THREE.BufferGeometry,THREE.MeshPhysicalMaterial>;return {tops:d.children.filter(o=>o.userData.entakuWoodTop).length,roughness:top.material.roughness,coat:top.material.clearcoat,reflective:top.userData.entakuReflective,bounds:new THREE.Box3().setFromObject(top).getSize(new THREE.Vector3()).toArray()};}};
render({});
