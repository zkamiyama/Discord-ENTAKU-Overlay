import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ExposureRenderer,createFallbackLights,protectDisplayObject} from '../../src/web/studio/exposure-renderer.ts';
import {prepareStudioMaterials} from '../../src/web/studio/studio-materials.ts';
import {loadStudioBundle,disposeObject} from '../../src/web/studio/loader.ts';
import {DEFAULT_EXPOSURE} from '../../src/studio/exposure.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';
const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(640,360,false);renderer.setClearColor(0,0);
const fallback=createFallbackLights(),pipeline=new ExposureRenderer(renderer,fallback),camera=new THREE.PerspectiveCamera(45,16/9,.05,200);
let scene=new THREE.Scene(),source=0,art:THREE.Mesh|undefined,model:THREE.Group|undefined;
function reset(){disposeObject(scene);scene=new THREE.Scene();scene.add(fallback);source++;camera.position.set(0,0,6);camera.lookAt(0,0,0);}
function texture(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d')!;x.clearRect(0,0,64,64);x.fillStyle='#e69123';x.beginPath();x.arc(32,32,24,0,Math.PI*2);x.fill();return c;}
async function fixture(){
 reset();const positions=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0]),uv=new Float32Array([0,0,1,0,1,1,0,0,1,1,0,1]);const data=new Uint8Array(positions.byteLength+uv.byteLength);data.set(new Uint8Array(positions.buffer));data.set(new Uint8Array(uv.buffer),positions.byteLength);
 const gltf={asset:{version:'2.0'},extensionsUsed:['KHR_materials_unlit'],scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],materials:[{extensions:{KHR_materials_unlit:{}},alphaMode:'BLEND',doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:texture().toDataURL()}],buffers:[{byteLength:data.length,uri:'data:application/octet-stream;base64,'+btoa(String.fromCharCode(...data))}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:uv.byteLength}],accessors:[{bufferView:0,componentType:5126,count:6,type:'VEC3',min:[-1,-1,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:6,type:'VEC2'}]};
 model=(await new GLTFLoader().parseAsync(JSON.stringify(gltf),location.origin+'/')).scene;prepareStudioMaterials(model);scene.add(model);model.traverse(o=>{if(o instanceof THREE.Mesh)art=o;});
 const wall=new THREE.Mesh(new THREE.PlaneGeometry(10,5),new THREE.MeshStandardMaterial({color:0x808080}));wall.position.z=-1;scene.add(wall);
 const light=new THREE.DirectionalLight(0xffffff,400);light.position.set(3,3,6);scene.add(light);
 const avatar=new THREE.Mesh(new THREE.PlaneGeometry(.6,.6),new THREE.MeshBasicMaterial({color:0x22aaff}));avatar.position.set(-1.7,0,.2);protectDisplayObject(avatar);scene.add(avatar);
 return {type:art!.material instanceof THREE.MeshBasicMaterial,alphaTest:(art!.material as THREE.Material).alphaTest};
}
function render(exposure=.00255,q:Record<string,unknown>={},p:Record<string,unknown>={}){return pipeline.render(scene,camera,{...DEFAULT_EXPOSURE,mode:'manual',manualExposure:exposure,lighting:'studio'},String(source),1,performance.now(),{...DEFAULT_QUALITY,ao:'off',reflections:false,fxaa:false,shadows:'off',...q},{...DEFAULT_POST,saturation:1,contrast:1,...p});}
function pixel(point:number[]){camera.updateMatrixWorld();const v=new THREE.Vector3(...point as [number,number,number]).project(camera),b=new Uint8Array(4),gl=renderer.getContext();gl.readPixels(Math.round((v.x+1)*320),Math.round((v.y+1)*180),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b];}
function shadow(mode:'BLEND'|'MASK'){
 reset();const map=new THREE.CanvasTexture(texture());map.colorSpace=THREE.SRGBColorSpace;
 const m=new THREE.MeshBasicMaterial({map,transparent:mode==='BLEND',alphaTest:mode==='MASK'?.5:0,side:THREE.DoubleSide,depthWrite:mode!=='BLEND'});art=new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.6),m);art.position.set(1,0,1);const root=new THREE.Group();root.add(art);prepareStudioMaterials(root);scene.add(root);
 const wall=new THREE.Mesh(new THREE.PlaneGeometry(8,5),new THREE.MeshStandardMaterial({color:0xcccccc,roughness:1}));scene.add(wall);
 const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(6,0,4);scene.add(light);return {alphaTest:m.alphaTest,transparent:m.transparent};
}
async function loadReal(id:string){reset();model=await loadStudioBundle({localFetch:(u:string)=>fetch(u)} as any,renderer,id);scene.add(model);const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3());camera.position.set(0,3.0,13);camera.lookAt(0,2.8,-3);const logos:any[]=[];model.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.entakuStudioUnlit){const b=new THREE.Box3().setFromObject(o);logos.push({name:o.name,center:b.getCenter(new THREE.Vector3()).toArray(),size:b.getSize(new THREE.Vector3()).toArray(),material:(o.material as THREE.Material).type});}});return {box:box.getSize(new THREE.Vector3()).toArray(),center:center.toArray(),logos};}
(window as any).studioMaterialProbe={fixture,shadow,render,pixel,loadReal,view(position:number[],target:number[]){camera.position.fromArray(position);camera.lookAt(new THREE.Vector3().fromArray(target));},occluder(){const o=new THREE.Mesh(new THREE.PlaneGeometry(.5,.5),new THREE.MeshBasicMaterial({color:0x00ff00}));o.position.set(0,0,.3);scene.add(o);source++;},artState:()=>({alphaTest:(art!.material as THREE.Material).alphaTest,depthWrite:(art!.material as THREE.Material).depthWrite}),renderer};
