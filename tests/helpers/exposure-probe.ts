import {DEFAULT_QUALITY,type QualitySettings} from '../../src/studio/quality.ts';
import * as THREE from 'three';
import {ExposureRenderer,createFallbackLights,protectDisplayObject} from '../../src/web/studio/exposure-renderer.ts';
import {CustomAvatarVisual} from '../../src/web/overlay/custom-avatar.ts';
import {DEFAULT_EXPOSURE,type ExposureSettings} from '../../src/studio/exposure.ts';
const canvas=document.querySelector<HTMLCanvasElement>('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});renderer.setSize(640,360,false);renderer.setClearColor(0,0);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,16/9,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
const rig=createFallbackLights();scene.add(rig);const exposure=new ExposureRenderer(renderer,rig);
const light=new THREE.DirectionalLight(0xffffff,10000);light.position.set(0,0,5);scene.add(light);
const world=new THREE.Mesh(new THREE.PlaneGeometry(6,4),new THREE.MeshStandardMaterial({color:0x808080,roughness:1}));world.position.z=-1;scene.add(world);
const icon=new THREE.Mesh(new THREE.CircleGeometry(.3,32),new THREE.MeshBasicMaterial({color:0xff2255}));icon.position.set(-.75,.2,0);protectDisplayObject(icon);scene.add(icon);
const label=new THREE.Mesh(new THREE.PlaneGeometry(.6,.15),new THREE.MeshBasicMaterial({color:0x21a849}));label.position.set(0,-.6,0);protectDisplayObject(label);scene.add(label);
const blocker=new THREE.Mesh(new THREE.BoxGeometry(.6,.2,.1),new THREE.MeshStandardMaterial({color:0x808080,roughness:1}));blocker.position.set(-.75,0,.2);scene.add(blocker);
const picture=document.createElement('canvas');picture.width=picture.height=128;const x=picture.getContext('2d')!;x.fillStyle='rgb(40,110,240)';x.fillRect(0,0,128,128);
const bitmap=await createImageBitmap(picture);
const avatar=await CustomAvatarVisual.create(bitmap,{userId:'1',assetId:'a'.repeat(64),image:{width:128,height:128,mime:'image/png'},faceRect:[.25,.25,.5,.5],scale:1,offsetX:0,offsetY:0});bitmap.close();avatar.root.position.set(.75,.2,0);avatar.update(1,0,-10);scene.add(avatar.root);
let settings:ExposureSettings={...DEFAULT_EXPOSURE},quality:QualitySettings={...DEFAULT_QUALITY},source=0;
function render(){return exposure.render(scene,camera,settings,String(source),1,performance.now(),quality);}
function pixel(px:number,py:number,pz=0){render();const p=new THREE.Vector3(px,py,pz).project(camera),rgba=new Uint8Array(4);renderer.getContext().readPixels(Math.floor((p.x+1)*320),Math.floor((p.y+1)*180),1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,rgba);return [...rgba];}
const api={
 quality(value:Partial<QualitySettings>){quality={...DEFAULT_QUALITY,...value};return render();},
 memory(){return {...renderer.info.memory};},
 manual(value:number){settings={...settings,mode:'manual',manualExposure:value,compensationEV:0};return render();},
 auto(){settings={...DEFAULT_EXPOSURE};source++;return render();},
 compensate(value:number){settings={...settings,compensationEV:value};return render();},
 hideDisplay(value:boolean){icon.visible=label.visible=avatar.root.visible=!value;source++;return render();},
 pixels(){return {icon:pixel(-.75,.3),avatar:pixel(.75,.2),label:pixel(0,-.6),world:pixel(0,.7,-1),occlusion:pixel(-.75,0,.2),alpha:pixel(4,2)};},
 report(){return render();},
};
(window as unknown as {exposureProbe:typeof api}).exposureProbe=api;
function frame(){render();requestAnimationFrame(frame);}frame();
