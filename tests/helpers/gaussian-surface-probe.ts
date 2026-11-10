import * as THREE from 'three';
import {PackedSplats} from '@sparkjsdev/spark';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {GaussianSurface,renderGaussianSurfaces} from '../../src/web/gaussian/surface.ts';
const canvas=document.querySelector('canvas')!,renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false});renderer.setSize(96,96,false);
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.set(0,0,3);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const target=new THREE.WebGLRenderTarget(96,96);target.depthTexture=new THREE.DepthTexture(96,96,THREE.UnsignedIntType);
const readback=new THREE.WebGLRenderTarget(96,96,{type:THREE.FloatType,depthBuffer:false});
const quad=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:{depth:{value:target.depthTexture},inverse:{value:camera.projectionMatrixInverse}},depthTest:false,depthWrite:false,toneMapped:false,
 vertexShader:'varying vec2 uvp;void main(){uvp=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:'varying vec2 uvp;uniform sampler2D depth;uniform mat4 inverse;void main(){vec4 p=inverse*vec4(uvp*2.-1.,texture2D(depth,uvp).r*2.-1.,1.);gl_FragColor=vec4(-p.z/p.w,0,0,1);}'
}));
type Entry={z:number;opacity:number;angle:number;scale?:[number,number,number]};
async function sample(entries:Entry[],threshold=.3,objectScale:[number,number,number]=[1,1,1],yaw=0){
 const packed=new PackedSplats();await packed.initialized;
 for(const e of entries)packed.pushSplat(new THREE.Vector3(0,0,e.z),new THREE.Vector3(...(e.scale??[.3,.25,.02])),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),e.angle),e.opacity,new THREE.Color(1,1,1));
 const surface=new GaussianSurface(packed);surface.alphaClip=threshold;surface.scale.set(...objectScale);surface.rotation.y=yaw;scene.add(surface);
 renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderGaussianSurfaces(renderer,scene,camera,'normal');
 const rgba=new Uint8Array(4);renderer.readRenderTargetPixels(target,48,48,1,1,rgba);
 renderer.setRenderTarget(readback);renderer.clear();quad.render(renderer);const value=new Float32Array(4);renderer.readRenderTargetPixels(readback,48,48,1,1,value);
 const result={rgba:Array.from(rgba),depth:value[0],draws:{...surface.drawCounts}};
 surface.dispose();packed.dispose();return result;
}
async function run(){
 const tilted={z:0,opacity:.9,angle:.4};
 return {
  plane:await sample([tilted]),
  reverseOrder:await sample([{z:.5,opacity:.9,angle:-.2},tilted]),
  forwardOrder:await sample([tilted,{z:.5,opacity:.9,angle:-.2}]),
  thinRejected:await sample([{...tilted,opacity:.25}]),
  thinAccepted:await sample([{...tilted,opacity:.25}],.1),
  transformed:await sample([tilted],.3,[1.8,.7,.5],.35),
  isotropic:await sample([{z:0,opacity:.9,angle:0,scale:[.2,.2,.2]}]),
  needle:await sample([{z:0,opacity:.9,angle:0,scale:[.05,.05,.5]}]),
 };
}
function dispose(){quad.material.dispose();quad.dispose();target.dispose();readback.dispose();renderer.dispose();}
(window as any).gaussianSurfaceProbe={run,dispose};
