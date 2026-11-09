import * as THREE from 'three';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {protectDisplayObject} from '../../src/web/studio/exposure-renderer.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import type {SplitPanel} from '../../src/contracts/domain.ts';
const canvas=document.querySelector('canvas')!,renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(640,360,false);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;
const split=new SplitRenderer(renderer),single=new QualityRenderer(renderer),scene=new THREE.Scene();
for(const [x,color]of [[-2,0xff2255],[2,0x2878dd]]){const marker=new THREE.Mesh(new THREE.CircleGeometry(.4,64),new THREE.MeshBasicMaterial({color}));marker.position.x=x!;protectDisplayObject(marker);scene.add(marker);}
const wall=new THREE.Mesh(new THREE.PlaneGeometry(12,1),new THREE.MeshBasicMaterial({color:0x888888}));wall.position.set(0,-.8,-2);scene.add(wall);
const block=new THREE.Mesh(new THREE.BoxGeometry(.5,.18,.1),new THREE.MeshBasicMaterial({color:0x808080}));block.position.set(-2,-.2,.1);scene.add(block);
const panel=(x:number,userId:string):SplitPanel=>({userId,pose:{position:[x,0,5],target:[x,0,0],fov:25}});
const panels:[SplitPanel,SplitPanel]=[panel(-2,'0'),panel(2,'1')];
let include=false;
function render(){return split.render(scene,panels,{...DEFAULT_QUALITY,ao:'off',reflections:false,fxaa:false,shadows:'off'}, {...DEFAULT_POST,bloom:true,bloomThreshold:.9,bloomStrength:.1,dof:true,excludeAvatars:!include,saturation:include?0:1},'probe',(panel,camera)=>{camera.position.fromArray(panel.pose.position);camera.lookAt(...panel.pose.target);camera.fov=panel.pose.fov;camera.near=.15;camera.far=100;return {distance:5,range:.5};});}
function pixel(x:number,y:number){const gl=renderer.getContext(),bytes=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return [...bytes];}
(window as any).splitProbe={render,pixels:()=>({left:pixel(160,195),right:pixel(480,195),occlusion:pixel(160,148),transparent:pixel(10,350)}),include(value:boolean){include=value;render();},single(){split.dispose();const camera=new THREE.PerspectiveCamera(45,16/9,.15,100);camera.position.set(-2,0,5);camera.lookAt(-2,0,0);camera.layers.enable(1);single.render(scene,camera,{...DEFAULT_QUALITY,ao:'off',reflections:false,fxaa:false,shadows:'off'},'single');return {center:pixel(320,195),memory:renderer.info.memory.textures};},memory:()=>renderer.info.memory.textures};
render();
