import * as THREE from 'three';
import type {Participant,SeatTransform,AppSnapshot} from '../../contracts/domain.ts';
import type {AvatarProfile} from '../../assets/avatar-profile.ts';
import type {StudioClient} from '../shared/client.ts';
import {CustomAvatarVisual} from './custom-avatar.ts';
import {loadImagePair} from '../shared/image-pair.ts';
import {NameplateVisual} from '../studio/nameplate.ts';
import {deskProps} from '../studio/broadcast-desk.ts';
import {platePosition} from '../../geometry/desk-props.ts';
import {avatarFacingYaw} from '../../geometry/avatar-facing.ts';
import {protectDisplayObject} from '../studio/exposure-renderer.ts';
import {DEFAULT_QUALITY} from '../../studio/quality.ts';
import {disposeObject} from '../studio/dispose.ts';
export interface AvatarContext {client:StudioClient;stage:THREE.Group;camera:THREE.Camera;failures:Set<string>;state:()=>AppSnapshot|null}
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
export class Avatar {
  root=new THREE.Group(); plate=new THREE.Group(); body:THREE.Mesh<THREE.CircleGeometry,THREE.ShaderMaterial>;
  outline:THREE.Mesh<THREE.RingGeometry,THREE.ShaderMaterial>; nameplate:NameplateVisual;
  private baseYaw=0;
  user:Participant; opacity=0; glow=0; disposed=false; textureVersion=0; avatarUrl?:string;
  custom:CustomAvatarVisual|null=null; profile?:AvatarProfile; customVersion=0; profileKey='';
  constructor(private context:AvatarContext,user:Participant,profile?:AvatarProfile){
    this.user=user; this.root.visible=this.plate.visible=false;
    this.body=new THREE.Mesh(new THREE.CircleGeometry(.28,64),imageMaterial(placeholder(user)));this.root.add(this.body);
    this.outline=new THREE.Mesh(new THREE.RingGeometry(.281,.60,64),new THREE.ShaderMaterial({
      uniforms:{strength:{value:0},glowScale:{value:4}},vertexShader,fragmentShader:`uniform float strength;uniform float glowScale;varying vec2 vUv;void main(){float d=(length(vUv-.5)*1.20-.28)/glowScale;float a=max(1.-smoothstep(.003,.009,d),exp(-d*d/.0002)*.28)*strength;gl_FragColor=vec4(vec3(.26,.9,.43)*(gl_FrontFacing?1.:.55),a);}`,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    this.root.add(this.outline);
    this.nameplate=new NameplateVisual(user.displayName);this.plate.add(this.nameplate,deskProps());
    protectDisplayObject(this.root);
    this.context.stage.add(this.root,this.plate);this.update(user,profile);
  }
  update(user:Participant,profile?:AvatarProfile):void {
    const key=JSON.stringify(profile??null);
    if(key!==this.profileKey){
      this.profileKey=key;const generation=++this.customVersion;this.profile=profile;
      if(!profile){this.context.failures.delete(this.user.userId);this.custom?.dispose();this.custom=null;this.body.visible=this.outline.visible=true;}
      else void loadImagePair(this.context.client.customImage(profile.assetId),profile.back?this.context.client.customImage(profile.back.assetId):undefined).then(async([bitmap,back])=>{
        try{
          if(this.disposed||generation!==this.customVersion)return;
          const next=await CustomAvatarVisual.create(bitmap,profile,back);
          if(this.disposed||generation!==this.customVersion){next.dispose();return;}
          this.context.failures.delete(this.user.userId);this.custom?.dispose();this.custom=next;this.root.add(next.root);this.body.visible=this.outline.visible=false;
        }finally{bitmap.close();back?.close();}
      }).catch(()=>{
        if(this.disposed||generation!==this.customVersion)return;
        this.custom?.dispose();this.custom=null;this.body.visible=this.outline.visible=true;
        // Rendering remains usable; diagnostic code contains no path, URL or capability.
        this.context.failures.add(this.user.userId);console.warn('CUSTOM_AVATAR_UNAVAILABLE');
      });
    }
    this.nameplate.setName(user.displayName,this.context.state()?.studio.quality?.nameplates??DEFAULT_QUALITY.nameplates);
    this.user=user;
    if(!profile&&user.avatarUrl!==this.avatarUrl){this.avatarUrl=user.avatarUrl;const version=++this.textureVersion;
      if(user.avatarUrl)void this.context.client.avatar(user.userId).then(bitmap=>{
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
    // Follow the current shot immediately. Camera MOVE may interpolate its pose,
    // but avatars must not keep swivelling after a CUT.
    this.baseYaw=seat.baseYawRad;this.faceCamera(this.context.camera.position);
    this.body.material.uniforms.opacity!.value=this.opacity;
    const speaking=connected&&this.user.speaking==='active'&&this.user.presence==='present';
    this.glow+=((speaking?1:0)-this.glow)*(1-Math.exp(-dt/(speaking?.06:.18)));
    const intensity=this.glow*this.opacity*(.875+.125*Math.sin(time*Math.PI*.004));
    this.outline.material.uniforms.strength!.value=intensity;const glowScale=this.context.state()?.studio.post?.speechGlowScale??4;this.outline.material.uniforms.glowScale!.value=glowScale;this.custom?.update(this.opacity,intensity,this.context.state()?.studio.tableAnchor.position[1]??0,glowScale);
    this.plate.position.fromArray(platePosition(seat));this.plate.rotation.y=seat.baseYawRad;
  }
  faceCamera(position:THREE.Vector3):void{this.root.rotation.y=avatarFacingYaw(this.baseYaw,position.x-this.root.position.x,position.z-this.root.position.z);}
  dispose():void {
    this.disposed=true;this.context.failures.delete(this.user.userId);this.custom?.dispose();this.custom=null;this.context.stage.remove(this.root,this.plate);
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});
    const texture=this.body.material.uniforms.map!.value as THREE.Texture;texture.dispose();if(texture.image instanceof ImageBitmap)texture.image.close();
    disposeObject(this.plate);
  }
}
