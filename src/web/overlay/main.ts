import { StudioVisual } from '../studio/visual.ts';
import { CustomAvatarVisual } from './custom-avatar.ts';
import { avatarFramingBounds,type AvatarProfile } from '../../assets/avatar-profile.ts';
import * as THREE from 'three';
import type { AppSnapshot, Participant, SeatTransform } from '../../contracts/domain.ts';
import { StudioClient } from '../shared/client.ts';
import { createRingData, updateRingData } from '../../geometry/table-geometry-data.ts';
import { TABLE } from '../../domain/defaults.ts';
import { samplePlan, widePose } from '../../domain/camera-planner.ts';

const client = new StudioClient();
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene(), stage=new THREE.Group(), camera = new THREE.PerspectiveCamera(45, 16/9, .05, 200);
scene.add(stage);
const studioVisual=new StudioVisual(client,renderer);scene.add(studioVisual.root);
scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x283342, 2));
const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3,6,4); scene.add(key);
const rimLight = new THREE.DirectionalLight(0x99b9ff, 1.5); rimLight.position.set(-3,3,-4); scene.add(rimLight);
class Ring {
  data = createRingData(); geometry = new THREE.BufferGeometry(); mesh: THREE.Mesh;
  constructor(private inner: number, private outer: number, private bottom: number, private top: number, color: number) {
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.data.positions,3));
    this.geometry.setAttribute('normal',new THREE.BufferAttribute(this.data.normals,3));
    this.geometry.setAttribute('uv',new THREE.BufferAttribute(this.data.uvs,2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.data.indices,1));
    this.mesh=new THREE.Mesh(this.geometry,new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.15}));
    stage.add(this.mesh);this.update(0);
  }
  update(length:number):void {
    updateRingData(this.data,this.inner,this.outer,length,this.bottom,this.top);
    this.geometry.getAttribute('position').needsUpdate=true;this.geometry.getAttribute('normal').needsUpdate=true;
    this.geometry.computeBoundingSphere();
  }
}
const table = [new Ring(.75,1.4,.69,.75,0xb8b4a6),new Ring(1.015,1.135,.12,.69,0x343d4b),new Ring(.955,1.195,.02,.12,0x222b38)];
const vertexShader = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
function imageMaterial(texture:THREE.Texture):THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({uniforms:{map:{value:texture},opacity:{value:1}},vertexShader,fragmentShader:`
    uniform sampler2D map;uniform float opacity;varying vec2 vUv;
    void main(){vec4 c=texture2D(map,vUv);if(c.a<.1)discard;c.rgb*=gl_FrontFacing?1.:.35;gl_FragColor=vec4(c.rgb,c.a*opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,side:THREE.DoubleSide,transparent:true,depthWrite:true});
}
function placeholder(user:Participant):THREE.CanvasTexture {
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d')!;
  const hue=[...user.userId].reduce((a,b)=>a+b.charCodeAt(0),0)*31%360;
  x.fillStyle=`hsl(${hue} 26% 30%)`;x.fillRect(0,0,256,256);x.fillStyle='#eff4fa';x.font='600 105px Meiryo, "Yu Gothic", "Noto Sans CJK JP", sans-serif';x.textAlign='center';x.textBaseline='middle';
  x.fillText([...user.displayName][0]??'?',128,132);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function labelTexture(name:string):THREE.CanvasTexture {
  const c=document.createElement('canvas');c.width=768;c.height=192;const x=c.getContext('2d')!;
  x.fillStyle='#ecf3f8';x.textAlign='center';x.textBaseline='middle';
  let size=76;do{x.font=`600 ${size}px Meiryo, "Yu Gothic", "Noto Sans CJK JP", sans-serif`;if(x.measureText(name).width<700)break;size-=2;}while(size>28);
  const label=[...name].length>24?[...name].slice(0,23).join('')+'…':name;x.fillText(label,384,100);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
class Avatar {
  root=new THREE.Group(); plate=new THREE.Group(); body:THREE.Mesh<THREE.CircleGeometry,THREE.ShaderMaterial>;
  outline:THREE.Mesh<THREE.RingGeometry,THREE.ShaderMaterial>; label:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
  user:Participant; opacity=0; glow=0; yaw=0; disposed=false; textureVersion=0; avatarUrl?:string;
  custom:CustomAvatarVisual|null=null; profile?:AvatarProfile; customVersion=0; profileKey='';
  constructor(user:Participant,profile?:AvatarProfile){
    this.user=user; this.root.visible=this.plate.visible=false;
    this.body=new THREE.Mesh(new THREE.CircleGeometry(.28,64),imageMaterial(placeholder(user)));this.root.add(this.body);
    this.outline=new THREE.Mesh(new THREE.RingGeometry(.281,.32,64),new THREE.ShaderMaterial({
      uniforms:{strength:{value:0}},vertexShader,fragmentShader:`uniform float strength;varying vec2 vUv;void main(){float d=length(vUv-.5)*.64-.28;float a=max(1.-smoothstep(.003,.009,d),exp(-d*d/.0002)*.28)*strength;gl_FragColor=vec4(vec3(.26,.9,.43)*(gl_FrontFacing?1.:.55),a);}`,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    this.root.add(this.outline);
    const base=new THREE.Mesh(new THREE.BoxGeometry(.62,.16,.035),new THREE.MeshStandardMaterial({color:0x243244,roughness:.45}));this.plate.add(base);
    this.label=new THREE.Mesh(new THREE.PlaneGeometry(.59,.147),new THREE.MeshBasicMaterial({map:labelTexture(user.displayName),transparent:true,depthWrite:false}));this.label.position.z=.019;this.plate.add(this.label);
    stage.add(this.root,this.plate);this.update(user,profile);
  }
  update(user:Participant,profile?:AvatarProfile):void {
    const key=JSON.stringify(profile??null);
    if(key!==this.profileKey){
      this.profileKey=key;const generation=++this.customVersion;this.profile=profile;
      if(!profile){avatarFailures.delete(this.user.userId);this.custom?.dispose();this.custom=null;this.body.visible=this.outline.visible=true;}
      else void Promise.all([client.customImage(profile.assetId),profile.back?client.customImage(profile.back.assetId):Promise.resolve(undefined)]).then(async([bitmap,back])=>{
        try{
          if(this.disposed||generation!==this.customVersion)return;
          const next=await CustomAvatarVisual.create(bitmap,profile,back);
          if(this.disposed||generation!==this.customVersion){next.dispose();return;}
          avatarFailures.delete(this.user.userId);this.custom?.dispose();this.custom=next;this.root.add(next.root);this.body.visible=this.outline.visible=false;
        }finally{bitmap.close();back?.close();}
      }).catch(()=>{
        if(this.disposed||generation!==this.customVersion)return;
        this.custom?.dispose();this.custom=null;this.body.visible=this.outline.visible=true;
        // Rendering remains usable; diagnostic code contains no path, URL or capability.
        avatarFailures.add(this.user.userId);console.warn('CUSTOM_AVATAR_UNAVAILABLE');
      });
    }
    if(this.user.displayName!==user.displayName){this.label.material.map?.dispose();this.label.material.map=labelTexture(user.displayName);this.label.material.needsUpdate=true;}
    this.user=user;
    if(!profile&&user.avatarUrl!==this.avatarUrl){this.avatarUrl=user.avatarUrl;const version=++this.textureVersion;
      if(user.avatarUrl)void client.avatar(user.userId).then(bitmap=>{
        if(this.disposed||version!==this.textureVersion){bitmap.close();return;}
        const texture=new THREE.Texture(bitmap);texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;
        const previous=this.body.material.uniforms.map!.value as THREE.Texture;previous.dispose();
        if(previous.image instanceof ImageBitmap)previous.image.close();this.body.material.uniforms.map!.value=texture;
      }).catch(()=>{});
    }
  }
  render(seat:SeatTransform,dt:number,time:number,connected:boolean):void {
    const visible=this.user.presence==='present'||this.user.presence==='stale';
    const target=visible?(this.user.presence==='stale'?.45:1):0;
    this.opacity+=(target-this.opacity)*(1-Math.exp(-dt/.2));this.root.visible=this.plate.visible=this.opacity>.005;
    this.root.position.fromArray(seat.faceAnchor);
    if(this.profile){this.root.position.x+=Math.cos(seat.baseYawRad)*this.profile.offsetX;this.root.position.z-=Math.sin(seat.baseYawRad)*this.profile.offsetX;this.root.position.y+=this.profile.offsetY;}
    const dx=camera.position.x-this.root.position.x,dz=camera.position.z-this.root.position.z;
    let delta=Math.atan2(dx,dz)-seat.baseYawRad;delta=Math.atan2(Math.sin(delta),Math.cos(delta));
    const front=Math.cos(delta),aim=front>0?THREE.MathUtils.clamp(delta,-Math.PI/6,Math.PI/6)*THREE.MathUtils.smoothstep(front,0,.25):0;
    this.yaw+=(aim-this.yaw)*(1-Math.exp(-dt/.15));this.root.rotation.y=seat.baseYawRad+this.yaw;
    this.body.material.uniforms.opacity!.value=this.opacity;
    const speaking=connected&&this.user.speaking==='active'&&this.user.presence==='present';
    this.glow+=((speaking?1:0)-this.glow)*(1-Math.exp(-dt/(speaking?.06:.18)));
    const intensity=this.glow*this.opacity*(.875+.125*Math.sin(time*Math.PI*.004));
    this.outline.material.uniforms.strength!.value=intensity;this.custom?.update(this.opacity,intensity,state?.studio.tableAnchor.position[1]??0);
    this.plate.position.set(seat.position[0]+seat.inward[0]*.66,.85,seat.position[2]+seat.inward[2]*.66);this.plate.rotation.y=seat.baseYawRad;
  }
  dispose():void {
    this.disposed=true;avatarFailures.delete(this.user.userId);this.custom?.dispose();this.custom=null;stage.remove(this.root,this.plate);
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});
    const texture=this.body.material.uniforms.map!.value as THREE.Texture;texture.dispose();if(texture.image instanceof ImageBitmap)texture.image.close();
    this.plate.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose();}});
  }
}
const avatarFailures=new Set<string>();
const avatars=new Map<string,Avatar>();let state:AppSnapshot|null=null;
client.onState=next=>{state=next;void studioVisual.update(next.studio);for(const p of next.participants){const avatar=avatars.get(p.userId);const profile=next.avatarProfiles.find(a=>a.userId===p.userId);if(avatar)avatar.update(p,profile);else avatars.set(p.userId,new Avatar(p,profile));}
  const ids=new Set(next.participants.map(p=>p.userId));for(const [id,avatar]of avatars)if(!ids.has(id)){avatar.dispose();avatars.delete(id);}
};
let previous=performance.now(),lastLength=-1,reportAt=0,frameMs=16.7;
let contextLost=false;canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;});canvas.addEventListener('webglcontextrestored',()=>{location.reload();});
function resize(){const w=Math.max(1,Math.min(innerWidth,innerHeight*16/9)),h=w*9/16;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(w,h);}
window.addEventListener('resize',resize);resize();
function frame(time:number):void{
  requestAnimationFrame(frame);frameMs=frameMs*.9+Math.min(1000,time-previous)*.1;const dt=Math.min((time-previous)/1000,.05);previous=time;
  const serverNow=client.now();let length=state?.straightLength??0;
  let progress=1;const motion=state?.layoutMotion;
  if(motion){progress=THREE.MathUtils.clamp((serverNow-motion.startMs)/motion.durationMs,0,1);progress=THREE.MathUtils.smootherstep(progress,0,1);length=THREE.MathUtils.lerp(motion.fromStraightLength,length,progress);}
  if(Math.abs(length-lastLength)>.00001){for(const ring of table)ring.update(length);lastLength=length;}
  const pose=state&&client.connected&&!studioVisual.loading&&!studioVisual.error?samplePlan(state.camera,serverNow):widePose(state?.straightLength??0,state?.avatarProfiles.map(p=>{const b=avatarFramingBounds(p);return {halfWidth:Math.max(-b.left,b.right)+Math.abs(p.offsetX),topY:1.25+p.offsetY+b.top,bottomY:Math.max(0,1.25+p.offsetY+b.bottom)};})??[]);
  camera.position.fromArray(pose.position);camera.lookAt(...pose.target);if(camera.fov!==pose.fov){camera.fov=pose.fov;camera.updateProjectionMatrix();}
  if(state)for(const reservation of state.session.reservations){
    const target=state.seats[reservation.slotIndex],avatar=avatars.get(reservation.userId);if(!target||!avatar)continue;
    let seat=target;const old=motion?.fromSeats[reservation.slotIndex];
    if(old&&progress<1){const position=target.position.map((x,i)=>THREE.MathUtils.lerp(old.position[i]!,x,progress)) as [number,number,number];
      seat={...target,position,faceAnchor:[position[0],1.25,position[2]],baseYawRad:old.baseYawRad+Math.atan2(Math.sin(target.baseYawRad-old.baseYawRad),Math.cos(target.baseYawRad-old.baseYawRad))*progress};
      seat={...seat,inward:[Math.sin(seat.baseYawRad),0,Math.cos(seat.baseYawRad)]};}
    avatar.render(seat,dt,time,client.connected&&state.connection==='ready');
  }
  if(state){const assigned=new Set(state.session.reservations.map(r=>r.userId));for(const [id,avatar]of avatars)if(!assigned.has(id)){avatar.root.visible=avatar.plate.visible=false;}}
  if(state){
    stage.position.fromArray(state.studio.tableAnchor.position);stage.rotation.y=THREE.MathUtils.degToRad(state.studio.tableAnchor.yawDeg);stage.updateMatrixWorld(true);
    const target=stage.localToWorld(new THREE.Vector3().fromArray(pose.target));stage.localToWorld(camera.position);camera.lookAt(target);
    const studioStatus=studioVisual.setLength(length);if(!client.connected||state.camera.studioHidden)studioVisual.root.visible=false;canvas.dataset.studioStatus=state.camera.studioHidden?'CAMERA_SAFE_FALLBACK':studioStatus;
    canvas.dataset.studioRevision=String(state.studio.revision);
  }
  if(!contextLost)renderer.render(scene,camera);
  if(time-reportAt>=1000){reportAt=time;client.reportRender(contextLost?'WEBGL_CONTEXT_LOST':avatarFailures.size?'CUSTOM_AVATAR_UNAVAILABLE':canvas.dataset.studioStatus??'READY',frameMs,renderer.info.render.calls,renderer.info.render.triangles);}
}
requestAnimationFrame(frame);client.connect();
