import * as THREE from 'three';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {DEFAULT_QUALITY,type QualitySettings} from '../../src/studio/quality.ts';
const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
renderer.setSize(480,270,false);renderer.setClearColor(0,1);renderer.outputColorSpace=THREE.SRGBColorSpace;
const effects=new QualityRenderer(renderer),camera=new THREE.PerspectiveCamera(45,16/9,.05,200);
let scene=new THREE.Scene(),source=0;
function reset(){scene=new THREE.Scene();source++;camera.position.set(0,0,0);camera.lookAt(0,0,-1);renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;}
function thin(){
 reset();
 const group=new THREE.Group();group.position.z=-20;group.rotation.y=.3;group.rotation.z=.15;scene.add(group);
 const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(24,14),new THREE.MeshBasicMaterial({color:0x777777}));group.add(backdrop);
 for(let i=0;i<18;i++){
  const stripe=new THREE.Mesh(new THREE.PlaneGeometry(18,.12),new THREE.MeshBasicMaterial({color:0x2046c8}));stripe.position.set(0,-3.8+i*.45,.004);group.add(stripe);
 }
 const shiny=new THREE.Mesh(new THREE.PlaneGeometry(20,8),new THREE.MeshStandardMaterial({color:0x808080,roughness:.2}));shiny.position.set(0,-5,-17);shiny.rotation.x=-Math.PI/3;scene.add(shiny,new THREE.HemisphereLight(0xffffff,0xffffff,1));
}
function edges(){
 reset();camera.position.z=5;camera.lookAt(0,0,0);
 for(let i=0;i<9;i++){
  const bar=new THREE.Mesh(new THREE.PlaneGeometry(.025,3),new THREE.MeshBasicMaterial({color:0xffffff}));bar.rotation.z=.13+i*.075;bar.position.x=-2+i*.5;scene.add(bar);
 }
 const disc=new THREE.Mesh(new THREE.CircleGeometry(.3,64),new THREE.MeshBasicMaterial({color:0xffffff}));disc.position.set(1.4,.9,.1);scene.add(disc);
}
function bounce(){
 reset();renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=.7;
 camera.position.set(3,2.6,5);camera.lookAt(0,.5,0);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshStandardMaterial({color:0xdddddd,roughness:1}));floor.rotation.x=-Math.PI/2;scene.add(floor);
 const red=new THREE.Mesh(new THREE.PlaneGeometry(4,2.5),new THREE.MeshStandardMaterial({color:0xff0808,roughness:1,side:THREE.DoubleSide}));red.rotation.y=Math.PI/2;red.position.set(-1,1.25,0);scene.add(red);
 const back=new THREE.Mesh(new THREE.PlaneGeometry(4,3),new THREE.MeshStandardMaterial({color:0x999999,roughness:1}));back.position.set(0,1.5,-2);scene.add(back);
 const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(4,5,3);scene.add(light);
}
function render(value:Partial<QualitySettings>){effects.render(scene,camera,{...DEFAULT_QUALITY,shadows:'off',...value},String(source));return {status:effects.status,samples:effects.msaaSamples,shadowLights:effects.shadowLights};}
function capture(){const gl=renderer.getContext(),p=new Uint8Array(480*270*4);gl.readPixels(0,0,480,270,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];}
function floorSample(){const gl=renderer.getContext(),p=new THREE.Vector3(-.65,.002,0).project(camera),data=new Uint8Array(9*9*4);gl.readPixels(Math.round((p.x+1)*240)-4,Math.round((p.y+1)*135)-4,9,9,gl.RGBA,gl.UNSIGNED_BYTE,data);const rgb=[0,0,0];for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)rgb[c]!+=data[i+c]!/81;return rgb;}
(window as any).qualityProbe={thin,edges,bounce,shadowRig(){
 reset();camera.position.set(4,3,6);camera.lookAt(0,0,0);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshStandardMaterial({color:0x808080}));floor.rotation.x=-Math.PI/2;scene.add(floor);
 const box=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xc08050}));box.position.y=.5;scene.add(box);
 for(let i=0;i<9;i++){const light=new THREE.DirectionalLight(0xffffff,.4);light.position.set(Math.sin(i)*3,4,Math.cos(i)*3);scene.add(light);}
 },reflect(){scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry instanceof THREE.PlaneGeometry&&o.rotation.x===-Math.PI/2)o.userData.entakuReflective=true;});},render,capture,floorSample,memory:()=>({...renderer.info.memory})};
