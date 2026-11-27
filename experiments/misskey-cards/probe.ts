import * as THREE from 'three';
import {MisskeyCards} from '../../src/web/overlay/misskey-cards.ts';
import {emptyMisskeyState,type MisskeyCard} from '../../src/contracts/misskey.ts';
import {misskeyCardPosition} from '../../src/geometry/misskey-card-layout.ts';

const canvas=document.querySelector('canvas')!;
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.info.autoReset=false;
const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
const device={vendor:String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR)),renderer:String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)),version:String(gl.getParameter(gl.VERSION))};
const now=Date.now();
const samples=[
  '音MADを見ながらみんなと集まれるの、楽しい！この立体スタジオの雰囲気も好き。',
  'Welcome to NicoMiss! A small message, a shared room, and a new perspective on the show.',
  '好きな作品について語り合える場所があるのはうれしいですね。'.repeat(9),
  '🎵 🎉 か\u3099 ぱぴぷぺぽ 👩‍👩‍👧‍👦 🇯🇵 この瞬間をみんなで楽しもう！ ✨',
];
const names=['音の旅人','Mika / Sound Lab','長いお名前の投稿者さん','にこにこ 🎵'];
function makeCard(slot:number,generation=0,sample=slot%4):MisskeyCard{
  return {id:`synthetic-${generation}-${slot}`,userId:`user-${slot}`,username:`nicomiss_${slot+1}`,authorName:names[sample]!,text:samples[sample]!,url:`https://otomad.site/notes/synthetic-${generation}-${slot}`,createdAt:new Date(now-1000).toISOString(),shownAt:now-2000,expiresAt:now+90000,slot,truncated:false};
}
function makeScene():{scene:THREE.Scene;dispose:()=>void}{
  const scene=new THREE.Scene();scene.background=new THREE.Color('#233c41');
  const material=new THREE.MeshBasicMaterial({color:'#597271'}),geometry=new THREE.CapsuleGeometry(.23,.72,4,12);
  for(let i=0;i<6;i++){
    const avatar=new THREE.Mesh(geometry,material),a=i*Math.PI/3;avatar.position.set(Math.sin(a)*1.9,1.15,Math.cos(a)*1.9);scene.add(avatar);
  }
  const tableGeometry=new THREE.CylinderGeometry(1.45,1.45,.12,48),tableMaterial=new THREE.MeshBasicMaterial({color:'#95a999'}),table=new THREE.Mesh(tableGeometry,tableMaterial);table.position.y=.7;scene.add(table);
  return {scene,dispose:()=>{geometry.dispose();material.dispose();tableGeometry.dispose();tableMaterial.dispose();scene.clear();}};
}
function camera(aspect:number,reverse=false):THREE.PerspectiveCamera{
  const camera=new THREE.PerspectiveCamera(48,aspect,.05,100);camera.position.set(reverse?-7:7,4.4,9);camera.lookAt(0,1.9,0);camera.layers.enable(1);camera.updateMatrixWorld(true);return camera;
}
function percentile(values:number[],p:number):number{const ordered=[...values].sort((a,b)=>a-b);return ordered[Math.min(ordered.length-1,Math.floor(ordered.length*p))]!;}
function memory(){return {...renderer.info.memory};}

(window as any).misskeyCardDevice=device;
(window as any).runMisskeyCardBenchmark=async(options:{count:number;split:boolean;frames:number;width:number})=>{
  const {count,split,frames,width}=options,height=Math.round(width*9/16),world=makeScene(),view=new MisskeyCards();world.scene.add(view.root);
  const cameras=[camera((split?width/2:width)/height),camera(width/2/height,true)],target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,generateMipmaps:false});
  const pixel=new Uint8Array(4),cards=Array.from({length:count},(_,slot)=>makeCard(slot));
  view.setState({...emptyMisskeyState(),status:'live',cards});
  await document.fonts.ready;
  const render=(time:number,synchronize:boolean)=>{
    view.prepare(0,0,true,time);renderer.info.reset();renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();
    if(split){
      renderer.autoClear=false;renderer.setScissorTest(true);
      for(let i=0;i<2;i++){renderer.setViewport(i*width/2,0,width/2,height);renderer.setScissor(i*width/2,0,width/2,height);renderer.render(world.scene,cameras[i]!);}
      renderer.setScissorTest(false);renderer.autoClear=true;
    }else renderer.render(world.scene,cameras[0]!);
    if(synchronize)renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
  };
  try{
    for(let i=0;i<20;i++)render(now+i*16,true);
    const staticUpdates=view.stats.textureUpdates,cpu:number[]=[],completed:number[]=[];
    for(let i=0;i<frames;i++){
      const start=performance.now();render(now+500+i*16,false);const submitted=performance.now();
      renderer.readRenderTargetPixels(target,0,0,1,1,pixel);const complete=performance.now();
      cpu.push(submitted-start);completed.push(complete-start);
    }
    const calls=renderer.info.render.calls,allocated=memory(),stats=view.stats;
    const result={...options,height,calls,memory:allocated,stats,staticTextureUpdateDelta:stats.textureUpdates-staticUpdates,cpuSubmissionMs:{median:percentile(cpu,.5),p95:percentile(cpu,.95)},synchronizedFrameMs:{median:percentile(completed,.5),p95:percentile(completed,.95)}};
    view.dispose();world.dispose();target.dispose();renderer.setRenderTarget(null);renderer.render(new THREE.Scene(),cameras[0]!);
    return {...result,memoryAfterDispose:memory()};
  }finally{view.dispose();world.dispose();target.dispose();}
};

(window as any).churnMisskeyCards=async()=>{
  const world=makeScene(),view=new MisskeyCards(),cam=camera(16/9);world.scene.add(view.root);renderer.setSize(960,540,false);renderer.setRenderTarget(null);
  const cards:MisskeyCard[]=[];await document.fonts.ready;
  for(let n=0;n<1000;n++){
    const slot=n%30;cards[slot]=makeCard(slot,n);
    view.setState({...emptyMisskeyState(),status:'live',cards:[...cards]});view.prepare(0,0,true,now+1000);
    renderer.render(world.scene,cam);
  }
  gl.finish();const retained={stats:view.stats,memory:memory()};
  view.dispose();world.dispose();renderer.render(new THREE.Scene(),cam);
  return {posts:1000,retained,memoryAfterDispose:memory()};
};

(window as any).captureMisskeyCards=async(sample:number|null)=>{
  const previous=(window as any).disposeMisskeyCapture as (()=>void)|undefined;previous?.();
  const world=sample===null?makeScene():{scene:new THREE.Scene(),dispose:()=>{}};
  world.scene.background=new THREE.Color('#233c41');
  const view=new MisskeyCards();world.scene.add(view.root);
  const cards=sample===null?Array.from({length:30},(_,slot)=>makeCard(slot)):[makeCard(0,0,sample)];
  view.setState({...emptyMisskeyState(),status:'live',cards});await document.fonts.ready;view.prepare(0,0,true,now+1000);
  const width=sample===null?1920:1024,height=sample===null?1080:512,cam=camera(width/height);
  if(sample!==null){const p=misskeyCardPosition(0,0);cam.position.set(p.x+p.inwardX*2.45,p.y,p.z+p.inwardZ*2.45);cam.lookAt(p.x,p.y,p.z);cam.fov=34;cam.updateProjectionMatrix();}
  renderer.setSize(width,height,false);renderer.setRenderTarget(null);renderer.setViewport(0,0,width,height);renderer.setScissorTest(false);renderer.render(world.scene,cam);gl.finish();
  (window as any).disposeMisskeyCapture=()=>{view.dispose();world.dispose();};
  return {width,height,stats:view.stats};
};

/** Real WebGL checks for the two risks that a Sprite-to-Mesh conversion adds:
 * animated camera poses and sequential cameras sharing one scene graph. */
(window as any).inspectMisskeyGeometryViews=async()=>{
  const width=640,height=360,scene=new THREE.Scene(),stage=new THREE.Group(),view=new MisskeyCards();
  scene.background=new THREE.Color('#233c41');scene.add(stage);stage.add(view.root);
  stage.position.set(9,3,-6);stage.rotation.set(.12,.7,-.08);stage.scale.set(1.6,.75,1.1);
  view.setState({...emptyMisskeyState(),status:'live',cards:[makeCard(0)]});
  await document.fonts.ready;
  const wallNow=now+1000;view.prepare(0,0,true,wallNow);scene.updateMatrixWorld(true);
  const mesh=view.root.children[0] as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
  const position=misskeyCardPosition(0,0),target=view.root.localToWorld(mesh.position.clone());
  const a=camera(width/height),b=camera(width/2/height),pixels=new Uint8Array(width*height*4);
  const pose=(cam:THREE.PerspectiveCamera,angle:number,roll:number,aspect:number)=>{
    const inward=3.4*Math.cos(angle),tangent=3.4*Math.sin(angle);
    cam.position.set(position.x+position.inwardX*inward-position.inwardZ*tangent,position.y+.25+.2*Math.sin(angle),position.z+position.inwardZ*inward+position.inwardX*tangent).applyMatrix4(view.root.matrixWorld);
    cam.up.set(Math.sin(roll),Math.cos(roll),0);cam.lookAt(target);cam.aspect=aspect;cam.updateProjectionMatrix();cam.updateMatrixWorld(true);
  };
  const observation=(cam:THREE.PerspectiveCamera)=>{
    const center=new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld),right=new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld,1);
    const normal=new THREE.Vector3().crossVectors(right,up).normalize(),toCamera=cam.position.clone().sub(center).normalize();
    const depths=[[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]].map(([x,y])=>new THREE.Vector3(x,y,0).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse).z);
    return {normal:normal.toArray(),right:right.clone().normalize().toArray(),up:up.clone().normalize().toArray(),facing:normal.dot(toCamera),centerError:center.distanceTo(target),orthogonality:Math.abs(right.normalize().dot(up.normalize())),depthRange:Math.max(...depths)-Math.min(...depths),matrix:mesh.matrixWorld.toArray()};
  };
  const read=()=>{gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);};
  const region=(start:number,end:number)=>{
    let white=0,hash=2166136261;
    for(let y=0;y<height;y++)for(let x=start;x<end;x++){
      const offset=(y*width+x)*4;
      if(pixels[offset]!>200&&pixels[offset+1]!>200&&pixels[offset+2]!>190&&pixels[offset+3]!>240)white++;
      for(let channel=0;channel<4;channel++)hash=Math.imul(hash^pixels[offset+channel]!,16777619);
    }
    return {white,hash:hash>>>0};
  };
  renderer.setSize(width,height,false);renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);
  try{
    const animation=[];
    for(let frame=0;frame<=12;frame++){
      const angle=(frame-6)*Math.PI/18;
      pose(a,angle,.2*Math.sin(angle),width/height);renderer.render(scene,a);read();
      animation.push({...observation(a),...region(0,width)});
    }
    // Isolate roll from orbit: a world-up implementation must not pass just
    // because the eye position changed between observations.
    const rollOnly=[];
    for(const roll of [0,.6]){
      pose(a,0,roll,width/height);renderer.render(scene,a);read();
      rollOnly.push({...observation(a),...region(0,width)});
    }
    pose(a,-.7,-.15,width/2/height);pose(b,.7,.15,width/2/height);
    const cameras=[a,b];
    const split=(order:number[])=>{
      renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();renderer.autoClear=false;renderer.setScissorTest(true);
      const views:ReturnType<typeof observation>[]=[];
      for(const index of order){
        renderer.setViewport(index*width/2,0,width/2,height);renderer.setScissor(index*width/2,0,width/2,height);renderer.render(scene,cameras[index]!);views[index]=observation(cameras[index]!);
      }
      renderer.setScissorTest(false);renderer.autoClear=true;read();
      return {views,panels:[region(0,width/2),region(width/2,width)]};
    };
    const forward=split([0,1]),reverse=split([1,0]);
    // Return to a prior single-camera pose without rebuilding cards or textures.
    pose(a,-Math.PI/3,.2*Math.sin(-Math.PI/3),width/height);
    renderer.setViewport(0,0,width,height);renderer.render(scene,a);read();
    const restored={...observation(a),...region(0,width)};
    const result={mesh:mesh.isMesh===true,geometry:mesh.geometry?.type,animation,rollOnly,forward,reverse,restored,stats:view.stats,memory:memory()};
    view.dispose();renderer.render(new THREE.Scene(),a);
    return {...result,memoryAfterDispose:memory()};
  }finally{renderer.autoClear=true;renderer.setScissorTest(false);view.dispose();scene.clear();}
};

(window as any).disposeMisskeyBenchmark=()=>{(window as any).disposeMisskeyCapture?.();renderer.dispose();renderer.forceContextLoss();};
