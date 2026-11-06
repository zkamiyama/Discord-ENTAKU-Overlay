import * as THREE from 'three';
import { avatarBounds,backProfile,type AvatarProfile } from '../../assets/avatar-profile.ts';
import { alphaField } from './alpha-field-client.ts';
const vertexShader=`varying vec2 vUv;varying float vWorldY;
void main(){vUv=uv;vWorldY=(modelMatrix*vec4(position,1.)).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export class CustomAvatarVisual {
  readonly root=new THREE.Group();
  private cards:Array<{geometry:THREE.PlaneGeometry;image:THREE.CanvasTexture;distance:THREE.DataTexture;body:THREE.ShaderMaterial;glow:THREE.ShaderMaterial}>=[];
  private constructor(readonly profile:AvatarProfile){}
  static async create(bitmap:ImageBitmap,profile:AvatarProfile,back?:ImageBitmap):Promise<CustomAvatarVisual>{
    const visual=new CustomAvatarVisual(profile);
    try{
      await visual.card(bitmap,profile,profile.back?'front':'double');
      const b=backProfile(profile);
      if(b){if(!back)throw new Error('BACK_IMAGE_REQUIRED');await visual.card(back,b,'back');}
      return visual;
    }catch(e){visual.dispose();throw e;}
  }
  private async card(bitmap:ImageBitmap,profile:AvatarProfile,side:'front'|'back'|'double'):Promise<void>{
    if(bitmap.width!==profile.image.width||bitmap.height!==profile.image.height)throw new Error('IMAGE_DIMENSIONS_MISMATCH');
    const ratio=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio)),pad=24;
    const canvas=document.createElement('canvas');canvas.width=width+2*pad;canvas.height=height+2*pad;
    const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,pad,pad,width,height);
    const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);
    for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3]!;
    if(!alpha.some(v=>v>=128))throw new Error('EMPTY_AVATAR_IMAGE');
    const field=await alphaField(alpha,canvas.width,canvas.height);
    const image=new THREE.CanvasTexture(canvas);image.colorSpace=THREE.SRGBColorSpace;
    const distance=new THREE.DataTexture(field.data,field.width,field.height,THREE.RedFormat);
    distance.flipY=true;distance.minFilter=distance.magFilter=THREE.LinearFilter;distance.generateMipmaps=false;distance.needsUpdate=true;
    const b=avatarBounds(profile),sx=(b.right-b.left)/width,sy=(b.top-b.bottom)/height;
    const geometry=new THREE.PlaneGeometry(canvas.width*sx,canvas.height*sy);
    geometry.translate((b.left+b.right)/2*(side==='back'?-1:1),(b.top+b.bottom)/2,0);
    const materialSide=side==='back'?THREE.BackSide:side==='front'?THREE.FrontSide:THREE.DoubleSide;
    const body=new THREE.ShaderMaterial({
      uniforms:{map:{value:image},opacity:{value:1},mirror:{value:side==='back'?1:0},floorY:{value:0}},vertexShader,
      fragmentShader:`uniform sampler2D map;uniform float opacity;uniform float mirror;uniform float floorY;varying vec2 vUv;varying float vWorldY;
      void main(){vec2 uv=vUv;if(mirror>.5)uv.x=1.-uv.x;vec4 c=texture2D(map,uv);if(c.a<.1||vWorldY<floorY)discard;
      c.rgb*=gl_FrontFacing?1.:(mirror>.5?.55:.35);gl_FragColor=vec4(c.rgb,c.a*opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,transparent:true,depthWrite:true,depthTest:true,side:materialSide,
    });
    const glow=new THREE.ShaderMaterial({
      uniforms:{field:{value:distance},strength:{value:0},spread:{value:field.spread},resolution:{value:new THREE.Vector2(field.width,field.height)},mirror:{value:side==='back'?1:0},floorY:{value:0}},vertexShader,
      fragmentShader:`uniform sampler2D field;uniform float strength;uniform float spread;uniform vec2 resolution;uniform float mirror;uniform float floorY;varying vec2 vUv;varying float vWorldY;
      void main(){vec2 uv=vUv;if(mirror>.5)uv.x=1.-uv.x;float d=(texture2D(field,uv).r-.5)*2.*spread;
      float texelsPerPixel=max(length(dFdx(uv)*resolution),length(dFdy(uv)*resolution));float pixelDistance=d/max(texelsPerPixel,.02);
      if(pixelDistance < -2. || pixelDistance > 14. || vWorldY<floorY)discard;
      float core=1.-smoothstep(1.,2.5,abs(pixelDistance));float soft=exp(-pow(max(0.,pixelDistance-1.5),2.)/18.)*.32;
      gl_FragColor=vec4(vec3(.20,.95,.35),max(core,soft)*strength*(gl_FrontFacing?1.:.55));
      #include <colorspace_fragment>
      }`,transparent:true,depthWrite:false,depthTest:true,side:materialSide,toneMapped:false,
    });
    this.cards.push({geometry,image,distance,body,glow});const bodyMesh=new THREE.Mesh(geometry,body),glowMesh=new THREE.Mesh(geometry,glow);glowMesh.renderOrder=1;this.root.add(bodyMesh,glowMesh);
  }
  update(opacity:number,strength:number,floorY=0):void{
    for(const c of this.cards){c.body.uniforms.opacity!.value=opacity;c.glow.uniforms.strength!.value=strength;c.body.uniforms.floorY!.value=c.glow.uniforms.floorY!.value=floorY;}
  }
  dispose():void{this.root.removeFromParent();for(const c of this.cards){c.geometry.dispose();c.image.dispose();c.distance.dispose();c.body.dispose();c.glow.dispose();}this.cards=[];this.root.clear();}
}
