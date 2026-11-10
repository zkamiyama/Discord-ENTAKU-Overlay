import * as THREE from 'three';
import {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {installFresnelPreview} from './fresnel.ts';
import {makeBust} from './fixture.ts';

const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true,preserveDrawingBuffer:true});
const w=900,h=900;renderer.setSize(w,h,false);renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
renderer.setClearColor(new THREE.Color().setRGB(.012,.016,.024),1);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(31,w/h,.05,30);
camera.position.set(.65,1.65,3.9);camera.lookAt(0,1.05,0);camera.updateMatrixWorld(true);
const spark=new SparkRenderer({renderer,enableLod:false,sortRadial:false,maxPixelRadius:512,depthTest:true,depthWrite:false});scene.add(spark);
const packed=await makeBust(),mesh=new SplatMesh({packedSplats:packed,raycastable:false});await mesh.initialized;scene.add(mesh);
const second=new SplatMesh({packedSplats:packed,raycastable:false});await second.initialized;
second.recolor.setRGB(1.15,.76,.58);second.visible=false;scene.add(second);
const speakers=new Map([[mesh,1],[second,0]]);
const effect=installFresnelPreview(spark,speakers);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0x253041,roughness:.85}));floor.rotation.x=-Math.PI/2;floor.position.y=-.02;scene.add(floor);
const table=new THREE.Mesh(new THREE.BoxGeometry(2.6,.09,.85),new THREE.MeshStandardMaterial({color:0x66544b,roughness:.55,metalness:.04}));table.position.set(0,.47,.50);scene.add(table);
const leg=new THREE.Mesh(new THREE.BoxGeometry(.12,.46,.12),new THREE.MeshStandardMaterial({color:0x303640}));leg.position.set(.85,.22,.52);scene.add(leg);
scene.add(new THREE.HemisphereLight(0xc4dcff,0x323b49,1.2));const key=new THREE.DirectionalLight(0xfff1dc,2.0);key.position.set(-3,6,5);scene.add(key);
const blocker=new THREE.Mesh(new THREE.BoxGeometry(.25,2.0,.20),new THREE.MeshStandardMaterial({color:0x737d8a,roughness:.8}));blocker.position.set(-.06,1.0,.85);blocker.visible=false;scene.add(blocker);
const target=new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType,depthBuffer:true});
const quad=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:{map:{value:target.texture}},depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
 vertexShader:'varying vec2 uvp;void main(){uvp=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`uniform sampler2D map;varying vec2 uvp;void main(){vec4 c=texture2D(map,uvp);gl_FragColor=sRGBTransferOETF(vec4(clamp(c.rgb,0.,1.),c.a));}`
}));
function draw(){renderer.setRenderTarget(target);renderer.clear();spark.render(scene,camera);renderer.setRenderTarget(null);renderer.clear();quad.render(renderer);}
async function settle(n=24){for(let i=0;i<n;i++){await new Promise(requestAnimationFrame);draw();}}
await settle(20);
async function capture(mode:0|1|2,layout:'single'|'overlap'|'blocker'|'hidden'='single',azimuth=0){
 effect.setMode(mode);blocker.visible=layout==='blocker'||layout==='hidden';
 blocker.scale.x=layout==='hidden'?8:1;
 second.visible=layout==='overlap';
 mesh.position.set(layout==='overlap'?-.16:0,0,layout==='overlap'?-.18:0);
 second.position.set(.36,-.03,.39);second.rotation.y=-.12;
 camera.position.set(.65+azimuth,1.65,3.9);camera.lookAt(0,1.05,0);camera.updateMatrixWorld(true);
 await settle(9);
 return {image:canvas.toDataURL('image/png'),splats:packed.numSplats,active:spark.activeSplats,ranges:effect.uniforms.speakerRanges.value.map(v=>v.toArray()),mode,layout};
}
function pixels(){const gl=renderer.getContext(),data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);return Array.from(data);}
const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
(window as any).fresnelPreview={capture,pixels,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),speakers,mesh,second,effect,spark};
console.log('FRESNEL_PREVIEW_READY',packed.numSplats);
