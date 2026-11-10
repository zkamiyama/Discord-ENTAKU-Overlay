import * as THREE from 'three';
import {PackedSplats,SplatMesh} from '@sparkjsdev/spark';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {GaussianRuntime} from '../../src/web/gaussian/runtime.ts';
import {packedCpuBytes} from '../../src/web/gaussian/assets.ts';
import {GAUSSIAN_COLOR_LAYER,GAUSSIAN_PROXY_LAYER} from '../../src/web/studio/gaussian-layers.ts';
import {QualityRenderer} from '../../src/web/studio/quality-renderer.ts';
import {SplitRenderer} from '../../src/web/studio/split-renderer.ts';
import {DEFAULT_QUALITY,type QualitySettings} from '../../src/studio/quality.ts';
import {DEFAULT_POST,type PostSettings} from '../../src/studio/post-effects.ts';
import type {SplitPanel} from '../../src/contracts/domain.ts';

// Original, deterministic synthetic splats: no model downloads or third-party
// character assets. These exercise the real packaged Spark shaders and workers.
const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(640,360,false);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,16/9,.05,100);
camera.position.set(0,2.1,5);camera.lookAt(0,.7,0);camera.layers.enable(1);
const runtime=new GaussianRuntime(renderer,scene),releaseVisual=runtime.retainVisual(),quality=new QualityRenderer(renderer),split=new SplitRenderer(renderer);
const packed=new PackedSplats({construct(data){
 for(let z=0;z<2;z++)for(let y=0;y<17;y++)for(let x=0;x<9;x++)data.pushSplat(new THREE.Vector3((x-4)*.08,.16+y*.08,(z-.5)*.08),new THREE.Vector3(.06,.06,.05),new THREE.Quaternion(),.94,new THREE.Color(1,1,1));
}});
await packed.initialized;await packed.createLodSplats();
const front=new SplatMesh({packedSplats:packed,raycastable:false}),rear=new SplatMesh({packedSplats:packed,raycastable:false});
for(const mesh of [front,rear]){mesh.layers.set(1);mesh.layers.enable(GAUSSIAN_COLOR_LAYER);mesh.userData.entakuGaussianInstance=true;scene.add(mesh);}
front.position.z=.3;rear.position.z=-.3;rear.recolor.setRGB(.025,.04,1);rear.visible=false;
let densePacked:PackedSplats|undefined,denseFront:SplatMesh|undefined,denseRear:SplatMesh|undefined;
async function prepareDense(){
 if(densePacked)return;
 densePacked=new PackedSplats({construct(data){
  // 9,216 distinct centers with several depth layers. Spark's standard traversal
  // tests projected PARENT-node size, so subpixel leaves alone do not imply a
  // large count reduction. At this 42-degree / 360px projection the published
  // WASM selects 9,216 at 2m, 8,880 at 40m, and 216 at 80m (before GPU culling).
  for(let z=0;z<8;z++)for(let y=0;y<48;y++)for(let x=0;x<24;x++)data.pushSplat(new THREE.Vector3((x-11.5)*.03,.16+y*.027,(z-3.5)*.015),new THREE.Vector3(.022,.020,.018),new THREE.Quaternion(),.65,new THREE.Color(1,1,1));
 }});
 await densePacked.initialized;await densePacked.createLodSplats();
 denseFront=new SplatMesh({packedSplats:densePacked,raycastable:false});denseRear=new SplatMesh({packedSplats:densePacked,raycastable:false});
 for(const mesh of [denseFront,denseRear]){mesh.layers.set(1);mesh.layers.enable(GAUSSIAN_COLOR_LAYER);mesh.userData.entakuGaussianInstance=true;scene.add(mesh);}
 denseFront.position.z=.3;denseRear.position.z=-.3;denseRear.recolor.setRGB(.025,.04,1);
}
const proxy=new THREE.Mesh(new THREE.BoxGeometry(.8,1.4,.22),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:THREE.DoubleSide}));
proxy.position.set(0,.8,.3);proxy.layers.set(GAUSSIAN_PROXY_LAYER);proxy.userData.entakuGaussianProxy=true;proxy.castShadow=true;scene.add(proxy);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,8),new THREE.MeshStandardMaterial({color:0x777777,roughness:.08,metalness:.35}));floor.rotation.x=-Math.PI/2;floor.userData.entakuReflective=true;scene.add(floor);
const blocker=new THREE.Mesh(new THREE.BoxGeometry(1.05,.7,.3),new THREE.MeshStandardMaterial({color:0x808080,roughness:.8}));blocker.position.set(0,.48,1.0);blocker.visible=false;scene.add(blocker);
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-2.5,4,2.2);scene.add(light,new THREE.HemisphereLight(0xffffff,0x777777,1.5));
let width=640,height=360,serial=0,splitMode=false,offscreen=false,denseMode=false,cameraDistance=5,q:QualitySettings={...DEFAULT_QUALITY},p:PostSettings={...DEFAULT_POST};
const singleTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true});
const present=new FullScreenQuad(new THREE.ShaderMaterial({uniforms:{color:{value:singleTarget.texture}},depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
 vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D color;varying vec2 v;void main(){gl_FragColor=texture2D(color,v);}'
}));
let frames:number[]=[];
const snapshots=new Map<string,Uint8Array>();
type Options={color?:'red'|'blue'|'white';proxy?:boolean;blocker?:boolean;rear?:boolean;split?:boolean;offscreen?:boolean;dense?:boolean;distance?:number;lodBudget?:number;width?:number;height?:number;quality?:Partial<QualitySettings>;post?:Partial<PostSettings>;exposure?:number;avatarX?:number;lightX?:number};
function configure(options:Options={}){
 serial++;width=options.width??640;height=options.height??360;renderer.setSize(width,height,false);camera.aspect=width/height;cameraDistance=options.distance??5;camera.position.set(0,.7+cameraDistance*.28,cameraDistance);camera.lookAt(0,.7,0);camera.updateProjectionMatrix();
 q={...DEFAULT_QUALITY,shadows:'off',ao:'off',reflections:false,fxaa:false,msaa:0,reflectionOpacity:.85,effectsScale:1,...options.quality};
 p={...DEFAULT_POST,enabled:false,saturation:1,contrast:1,...options.post};
 renderer.toneMappingExposure=options.exposure??1;splitMode=!!options.split;offscreen=!!options.offscreen;denseMode=!!options.dense;runtime.setBudget(options.lodBudget??10000,splitMode?2:1);
 front.recolor.setRGB(...(options.color==='blue'?[.025,.04,1]:options.color==='white'?[1,1,1]:[1,.025,.025]) as [number,number,number]);
 proxy.visible=options.proxy!==false;front.visible=!denseMode;rear.visible=!!options.rear&&!denseMode;blocker.visible=!!options.blocker;
 front.position.x=proxy.position.x=options.avatarX??0;light.position.x=options.lightX??-2.5;
 if(denseFront&&denseRear){denseFront.visible=denseMode;denseRear.visible=denseMode&&!!options.rear;denseFront.recolor.copy(front.recolor);denseFront.position.x=front.position.x;}
}
function draw(){
 if(splitMode){
  const panels:readonly [SplitPanel,SplitPanel]=[{userId:'front',pose:{position:[0,.8+cameraDistance*.14,cameraDistance],target:[0,.8,0],fov:40}},{userId:'rear',pose:{position:[0,.8+cameraDistance*.14,-cameraDistance],target:[0,.8,0],fov:40}}];
  split.render(scene,panels,q,p,String(serial),(panel,view)=>{view.position.fromArray(panel.pose.position);view.lookAt(new THREE.Vector3().fromArray(panel.pose.target));view.fov=panel.pose.fov;view.near=.05;view.far=100;return {distance:cameraDistance,range:.3};});
 }else{
  if(offscreen){if(singleTarget.width!==width||singleTarget.height!==height)singleTarget.setSize(width,height);renderer.setRenderTarget(singleTarget);}
  quality.render(scene,camera,q,String(serial),p,{distance:cameraDistance*1.04,range:.3},offscreen);
  if(offscreen){renderer.setRenderTarget(null);renderer.clear();present.render(renderer);}
 }
}
async function settle(options:Options={},count=24){
 if(options.dense)await prepareDense();
 configure(options);return settleFrames(count);
}
async function settleFrames(count=24){
 frames=[];let last=performance.now();
 for(let i=0;i<count;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));draw();const now=performance.now();frames.push(now-last);last=now;}
 return status();
}
// LoD and sorting are asynchronous. Check the completed LoD camera/budget as
// well as stable counts, so an old selection cannot satisfy the next scenario.
async function settleLod(options:Options={}){
 await settle(options,options.split?40:36);let stable=0,previous='',last=performance.now();
 for(let i=0;i<180;i++){
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));draw();const now=performance.now();frames.push(now-last);last=now;const state=status();
  const ready=state.activeViews.length===(options.split?2:1)&&state.activeViews.every(view=>
   !view.lodPending&&view.lodBudget===view.budget&&view.lodPosition&&view.cameraPosition.every((value,index)=>Math.abs(value-view.lodPosition![index]!)<1e-4));
  const signature=JSON.stringify(state.activeViews.map(view=>[view.selectedSplats,view.lodInstances]));
  stable=ready&&signature===previous?stable+1:0;previous=signature;
  if(stable>=4)return state;
 }
 throw new Error('GAUSSIAN_LOD_DID_NOT_SETTLE '+JSON.stringify(status()));
}
// A light-only movement keeps the caller's scene revision, camera, avatar and
// quality settings fixed. The production shadow index must detect the move.
async function moveLight(x:number,count=24){light.position.x=x;return settleFrames(count);}
function pixels(){const gl=renderer.getContext(),data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
function save(name:string){snapshots.set(name,pixels());return stats();}
function sample(y=.8){const v=new THREE.Vector3(front.position.x,y,.3).project(camera),gl=renderer.getContext(),data=new Uint8Array(4);gl.readPixels(Math.floor((v.x+1)*width/2),Math.floor((v.y+1)*height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data];}
function bounds(){const point=new THREE.Vector3(0,.04,.3).project(camera);return {floorTop:Math.floor((point.y+1)*height/2)-6};}
function stats(){
 const data=pixels(),b=bounds();let red=0,blue=0,transparent=0,redFloor=0,blueFloor=0,leftRed=0,leftBlue=0,rightRed=0,rightBlue=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,r=data[i]!,g=data[i+1]!,bl=data[i+2]!,a=data[i+3]!;
  const isRed=a>150&&r>g*1.6+10&&r>bl*1.6+10,isBlue=a>150&&bl>g*1.6+10&&bl>r*1.6+10;
  if(a===0)transparent++;
  if(isRed){red++;if(y<b.floorTop)redFloor++;if(x<width/2)leftRed++;else rightRed++;}
  if(isBlue){blue++;if(y<b.floorTop)blueFloor++;if(x<width/2)leftBlue++;else rightBlue++;}
 }
 return {red,blue,transparent,redFloor,blueFloor,leftRed,leftBlue,rightRed,rightBlue,width,height,...b};
}
function compare(a:string,b:string,region:'all'|'floor'='all'){
 const first=snapshots.get(a)!,second=snapshots.get(b)!;if(first.length!==second.length)throw new Error('IMAGE_SIZE_MISMATCH');
 const top=region==='floor'?bounds().floorTop:height;let changed=0,darker=0,redChange=0,blueChange=0,max=0,total=0,count=0;
 for(let y=0;y<top;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,d=Math.abs(first[i]!-second[i]!)+Math.abs(first[i+1]!-second[i+1]!)+Math.abs(first[i+2]!-second[i+2]!);
  if(d>12)changed++;if(first[i]!+first[i+1]!+first[i+2]!>second[i]!+second[i+1]!+second[i+2]!+20)darker++;
  redChange+=second[i]!-first[i]!;blueChange+=second[i+2]!-first[i+2]!;max=Math.max(max,d);total+=d;count++;
 }
 return {changed,darker,redChange,blueChange,max,mean:total/count};
}
function reflectionAppearance(redOff:string,redOn:string,blueOff:string,blueOn:string){
 const a=snapshots.get(redOff)!,b=snapshots.get(redOn)!,c=snapshots.get(blueOff)!,d=snapshots.get(blueOn)!;
 // Difference-of-differences cancels any directly visible splat fringe in the
 // floor ROI: only the color change caused by enabling SSR can satisfy this.
 const top=bounds().floorTop;let changed=0,redGain=0,blueGain=0,redSignal=0,blueSignal=0;
 for(let y=0;y<top;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,dr=(d[i]!-c[i]!)-(b[i]!-a[i]!),db=(d[i+2]!-c[i+2]!)-(b[i+2]!-a[i+2]!);
  if(Math.abs(dr)+Math.abs(db)>12)changed++;
  redGain-=dr;blueGain+=db;redSignal+=b[i]!-a[i]!;blueSignal+=d[i+2]!-c[i+2]!;
 }
 return {changed,redGain,blueGain,redSignal,blueSignal};
}
function shadowMovement(beforeOff:string,beforeOn:string,afterOff:string,afterOn:string){
 const a=snapshots.get(beforeOff)!,b=snapshots.get(beforeOn)!,c=snapshots.get(afterOff)!,d=snapshots.get(afterOn)!;
 let beforeDarkened=0,afterDarkened=0,shifted=0,beforeWeight=0,afterWeight=0,beforeX=0,afterX=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;
  // The fixture's opaque neutral surface is the floor. Do not restrict this to
  // the reflection ROI in front of the avatar: these shadows extend behind it.
  const neutral=(p:Uint8Array)=>p[i+3]!>250&&Math.max(p[i]!,p[i+1]!,p[i+2]!)-Math.min(p[i]!,p[i+1]!,p[i+2]!)<5;
  const firstFloor=neutral(a),secondFloor=neutral(c);if(!firstFloor&&!secondFloor)continue;
  const sum=(p:Uint8Array)=>p[i]!+p[i+1]!+p[i+2]!;
  const first=firstFloor?sum(a)-sum(b):0,second=secondFloor?sum(c)-sum(d):0;
  // OFF/ON differences cancel the floor's direct/specular illumination change
  // when the light moves. Only a change in the shadow response satisfies this.
  if(first>20){beforeDarkened++;beforeWeight+=first;beforeX+=x*first;}
  if(second>20){afterDarkened++;afterWeight+=second;afterX+=x*second;}
  if(Math.abs(first-second)>20)shifted++;
 }
 return {beforeDarkened,afterDarkened,shifted,beforeCenterX:beforeWeight?beforeX/beforeWeight:null,afterCenterX:afterWeight?afterX/afterWeight:null};
}
function status(){const sorted=frames.slice(4).sort((a,b)=>a-b),source=denseMode?densePacked!:packed,r=runtime.diagnostics();return {quality:quality.status,memory:{...renderer.info.memory},runtime:r,activeViews:r.views.filter(v=>splitMode?v.camera!==camera.uuid:v.camera===camera.uuid),source:{inputSplats:source.numSplats,lodSplats:source.lodSplats?.numSplats??0,originalCpuBytes:packedCpuBytes(source),lodCpuBytes:packedCpuBytes(source.lodSplats)},sceneState:{revision:serial,avatarPosition:front.position.toArray(),lightPosition:light.position.toArray()},p50:sorted[Math.floor(sorted.length*.5)]??0,p95:sorted[Math.floor(sorted.length*.95)]??0,stats:stats(),sample:sample()};}
function dispose(){quality.dispose();split.dispose();singleTarget.dispose();present.material.dispose();present.dispose();releaseVisual();runtime.dispose();for(const mesh of [front,rear,denseFront,denseRear])if(mesh){mesh.packedSplats=undefined;mesh.splats=undefined;mesh.dispose();}packed.dispose();densePacked?.dispose();for(const mesh of [proxy,floor,blocker]){mesh.geometry.dispose();mesh.material.dispose();}renderer.dispose();}
(window as unknown as {gaussianRenderProbe:unknown}).gaussianRenderProbe={settle,settleLod,moveLight,draw,save,compare,reflectionAppearance,shadowMovement,stats,status,sample,dispose};
configure();draw();
