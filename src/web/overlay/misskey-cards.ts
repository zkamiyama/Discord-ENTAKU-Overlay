import * as THREE from 'three';
import {MISSKEY_CARD_LIMIT,type MisskeyCard,type MisskeyState} from '../../contracts/misskey.ts';
import {MISSKEY_CARD_HEIGHT,MISSKEY_CARD_WIDTH,misskeyCardFacing,misskeyCardPosition,misskeyCardTilt,type MisskeyCardPosition} from '../../geometry/misskey-card-layout.ts';
import {protectDisplayObject} from '../studio/exposure-renderer.ts';

export const MISSKEY_TEXTURE_WIDTH=512;
export const MISSKEY_TEXTURE_HEIGHT=256;
export const MISSKEY_TEXTURE_BYTES=MISSKEY_TEXTURE_WIDTH*MISSKEY_TEXTURE_HEIGHT*4;
const font='"Yu Gothic",Meiryo,"Noto Sans CJK JP",sans-serif';
const graphemes=new Intl.Segmenter('ja',{granularity:'grapheme'});
const ease=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};

export interface MisskeyCardStats {
  /** Live cards before per-camera near-side suppression and frustum culling. */
  visible:number;allocated:number;textures:number;textureBytes:number;textureUpdates:number;
}
interface CardSlot {
  mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;texture:THREE.CanvasTexture;context:CanvasRenderingContext2D;tilt:THREE.Quaternion;
  card:MisskeyCard|null;signature:string;position:MisskeyCardPosition;baseOpacity:number;
}

function fitText(text:string,maxWidth:number,measure:(text:string)=>number):string {
  if(measure(text)<=maxWidth)return text;
  let value='';
  for(const {segment} of graphemes.segment(text)){
    if(measure(value+segment+'…')>maxWidth)break;
    value+=segment;
  }
  return value+'…';
}

/** Width and line limits are independent of the server's character limit.
 * A single grapheme is never split, even when it consists of many code points. */
export function misskeyCardLines(text:string,measure:(text:string)=>number,maxWidth:number,maxLines=5):{lines:string[];truncated:boolean} {
  if(!Number.isFinite(maxWidth)||maxWidth<=0||!Number.isInteger(maxLines)||maxLines<1||maxLines>10)throw new RangeError('MISSKEY_TEXT_LAYOUT_INVALID');
  const lines:string[]=[];let line='',truncated=false;
  const iterator=graphemes.segment(text.replace(/\r\n?/g,'\n'))[Symbol.iterator]();
  for(let next=iterator.next();!next.done;next=iterator.next()){
    const {segment}=next.value;
    if(segment==='\n'){
      lines.push(line);line='';
      if(lines.length===maxLines){truncated=!iterator.next().done;break;}
      continue;
    }
    if(line&&measure(line+segment)>maxWidth){
      // Prefer complete Latin words and avoid common Japanese line-head
      // punctuation. Long tokens still fall back to intact graphemes.
      const previous=line;let carry='';
      const word=/[ \t]([\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N}'’_-]*)$/u.exec(line);
      if(word&&/^[\p{Script=Latin}\p{N}'’_-]$/u.test(segment)){
        carry=word[1]!;line=line.slice(0,line.length-carry.length).trimEnd();
      }else{
        const parts=[...graphemes.segment(line)].map(value=>value.segment),last=parts.at(-1)!;
        if(parts.length>1&&(/^[、。，．！？!?,.:;）)］\]｝}」』】〉》〕…]/u.test(segment)||/^[（(［\[｛{「『【〈《〔]$/u.test(last))){
          carry=parts.pop()!;line=parts.join('');
        }
      }
      if(!line||measure(carry+segment)>maxWidth){line=previous;carry='';}
      lines.push(line.trimEnd());line=carry;
      if(lines.length===maxLines){truncated=true;break;}
      if(!line&&/^[ \t]$/u.test(segment))continue;
    }
    if(measure(segment)>maxWidth){truncated=true;line='…';break;}
    line+=segment;
  }
  if(line&&lines.length<maxLines)lines.push(line);
  if(truncated&&lines.length){
    const last=lines.length-1;
    lines[last]=fitText(lines[last]!.replace(/…$/u,'')+'…',maxWidth,measure);
  }
  return {lines,truncated};
}

/** At most thirty fixed-size canvas textures. Transforms and material opacity
 * animate; pixels only change when a card's display content or the font changes. */
export class MisskeyCards {
  readonly root=new THREE.Group();
  private readonly geometry=new THREE.PlaneGeometry(1,1);
  private readonly slots=new Map<number,CardSlot>();
  private state:MisskeyState|null=null;
  private disposed=false;
  private fontRevision=0;
  private updates=0;
  private active=0;
  private dirty=false;
  private readonly cameraPosition=new THREE.Vector3();
  private readonly localCameraPosition=new THREE.Vector3();
  private readonly cameraUp=new THREE.Vector3();
  private readonly worldPosition=new THREE.Vector3();
  private readonly worldScale=new THREE.Vector3();
  private readonly rootScale=new THREE.Vector3(1,1,1);
  private readonly worldRotation=new THREE.Quaternion();
  private readonly facingMatrix=new THREE.Matrix4();
  private readonly tiltEuler=new THREE.Euler();
  private readonly inverseRoot=new THREE.Matrix4();
  private readonly rootMatrix=new THREE.Matrix4();
  private rootInvertible=true;
  constructor(private readonly canvasFactory:()=>HTMLCanvasElement=()=>document.createElement('canvas')){
    this.root.name='Misskey public hashtag cards';this.root.visible=false;
    protectDisplayObject(this.root);
    if(typeof document!=='undefined'&&document.fonts){
      void document.fonts.ready.then(()=>{if(!this.disposed){this.fontRevision++;this.dirty=true;}});
    }
  }
  get stats():MisskeyCardStats {
    return {visible:this.active,allocated:this.slots.size,textures:this.slots.size,textureBytes:this.slots.size*MISSKEY_TEXTURE_BYTES,textureUpdates:this.updates};
  }
  setState(state:MisskeyState|null):void {
    if(this.disposed)return;
    this.state=state;this.dirty=true;
    if(!state||state.status==='disabled'||state.paused){
      this.root.visible=false;this.active=0;
      for(const slot of this.slots.values()){slot.mesh.visible=false;slot.card=null;}
    }
  }
  prepare(straightLength:number,offsetZ:number,connected:boolean,wallNow=Date.now()):void {
    if(this.disposed)return;
    const state=this.state;
    this.active=0;this.root.visible=false;
    for(const slot of this.slots.values())slot.mesh.visible=false;
    if(!state||!connected||state.status==='disabled'||state.paused||!Number.isFinite(wallNow))return;
    for(const card of state.cards.slice(0,MISSKEY_CARD_LIMIT)){
      if(card.shownAt>wallNow||card.expiresAt<=wallNow||!Number.isInteger(card.slot)||card.slot<0||card.slot>=MISSKEY_CARD_LIMIT)continue;
      const slot=this.slots.get(card.slot)??this.allocate(card.slot);
      if(this.dirty||slot.card!==card||!slot.signature){
        const signature=JSON.stringify([card.id,card.authorName,card.username,card.text,card.truncated,state.hashtag,this.fontRevision]);
        if(slot.signature!==signature){this.draw(slot,card,state.hashtag);slot.signature=signature;}
      }
      slot.card=card;
      slot.position=misskeyCardPosition(card.slot,straightLength,offsetZ);
      const age=wallNow-card.shownAt,remaining=card.expiresAt-wallNow;
      slot.baseOpacity=ease(age/420)*ease(remaining/850);
      slot.mesh.material.opacity=slot.baseOpacity;
      const phase=card.slot*2.399963229728653,time=wallNow/1000;
      slot.mesh.position.set(slot.position.x,slot.position.y+Math.sin(time*.45+phase)*.035+(1-ease(age/420))*.08,slot.position.z);
      const scale=.965+.035*ease(age/420);
      slot.mesh.scale.set(MISSKEY_CARD_WIDTH*scale,MISSKEY_CARD_HEIGHT*scale,1);
      const tilt=misskeyCardTilt(card.slot,time);slot.tilt.setFromEuler(this.tiltEuler.set(tilt.x,tilt.y,tilt.z));
      // Transparent sorting happens before onBeforeRender. Keep the centered
      // plane's translation current here; only its orientation changes per view.
      slot.mesh.matrix.setPosition(slot.mesh.position);slot.mesh.matrixWorldNeedsUpdate=true;
      slot.mesh.visible=slot.baseOpacity>.001;this.active+=Number(slot.mesh.visible);
    }
    this.dirty=false;
    this.root.visible=this.active>0;
  }
  private allocate(index:number):CardSlot {
    const canvas=this.canvasFactory();canvas.width=MISSKEY_TEXTURE_WIDTH;canvas.height=MISSKEY_TEXTURE_HEIGHT;
    const context=canvas.getContext('2d');if(!context)throw new Error('MISSKEY_CANVAS_UNAVAILABLE');
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
    const material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false,depthTest:true,depthWrite:false,transparent:true,side:THREE.FrontSide,fog:false});
    const mesh=new THREE.Mesh(this.geometry,material);mesh.name=`Misskey card slot ${index}`;mesh.visible=false;
    // Spark batches all Gaussian avatars into one scene-origin draw node, so
    // its transparent sort depth cannot represent each transformed person.
    // Cards form the background: draw before people, retaining opaque depth.
    mesh.renderOrder=-1;mesh.matrixAutoUpdate=false;
    // A prior view's orientation must not cull this view before its callback.
    // There are at most thirty two-triangle cards, each one FrontSide draw.
    mesh.frustumCulled=false;
    const slot:CardSlot={mesh,texture,context,tilt:new THREE.Quaternion(),card:null,signature:'',position:misskeyCardPosition(index,0),baseOpacity:0};
    mesh.onBeforeRender=(_renderer,_scene,camera)=>{
      const matrix=this.root.matrixWorld;
      if(!this.rootMatrix.equals(matrix)){
        this.rootMatrix.copy(matrix);const determinant=matrix.determinant();this.rootInvertible=Number.isFinite(determinant)&&determinant!==0;
        this.inverseRoot.copy(matrix).invert();this.rootScale.setFromMatrixScale(matrix);
      }
      if(!this.rootInvertible){material.opacity=0;return;}
      this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
      this.localCameraPosition.copy(this.cameraPosition).applyMatrix4(this.inverseRoot);
      material.opacity=slot.baseOpacity*misskeyCardFacing(slot.position,this.localCameraPosition.x,this.localCameraPosition.z);
      this.worldPosition.copy(mesh.position).applyMatrix4(matrix);
      this.cameraUp.setFromMatrixColumn(camera.matrixWorld,1).normalize();
      this.facingMatrix.lookAt(this.cameraPosition,this.worldPosition,this.cameraUp);
      this.worldRotation.setFromRotationMatrix(this.facingMatrix).multiply(slot.tilt);
      this.worldScale.copy(this.rootScale).multiply(mesh.scale);
      // Recompute from this camera, never from the previous SPLIT view. Keep
      // the inverse-parent product as a matrix: decompose loses the shear that
      // cancels non-uniform parent scale. r187 computes modelViewMatrix next.
      mesh.matrixWorld.compose(this.worldPosition,this.worldRotation,this.worldScale);
      mesh.matrix.multiplyMatrices(this.inverseRoot,mesh.matrixWorld);mesh.matrixWorldNeedsUpdate=false;
    };
    protectDisplayObject(mesh);this.root.add(mesh);this.slots.set(index,slot);return slot;
  }
  private draw(slot:CardSlot,card:MisskeyCard,hashtag:string):void {
    const x=slot.context,c=slot.texture.image as HTMLCanvasElement;
    x.clearRect(0,0,c.width,c.height);x.textAlign='left';x.textBaseline='alphabetic';
    x.fillStyle='#fbfcf7';x.beginPath();x.roundRect(2,2,508,252,18);x.fill();
    x.strokeStyle='#bed8d6';x.lineWidth=1.5;x.stroke();
    x.fillStyle='#24b7b2';x.beginPath();x.roundRect(20,18,4,38,2);x.fill();
    x.fillStyle='#e2f1e9';x.beginPath();x.arc(51,37,20,0,Math.PI*2);x.fill();
    x.fillStyle='#1b6260';x.font=`700 23px ${font}`;x.textAlign='center';x.textBaseline='middle';
    const initial=graphemes.segment(card.authorName||card.username)[Symbol.iterator]().next().value?.segment??'?';
    x.fillText(initial,51,38,33);x.textAlign='left';x.textBaseline='alphabetic';
    x.fillStyle='#203936';x.font=`700 20px ${font}`;
    x.fillText(fitText(card.authorName||card.username,410,value=>x.measureText(value).width),82,32);
    x.fillStyle='#687c7a';x.font=`500 14px ${font}`;
    x.fillText(fitText('@'+card.username,410,value=>x.measureText(value).width),82,53);
    x.fillStyle='#e3ebe4';x.fillRect(20,66,472,1);
    x.font=`500 22px ${font}`;x.fillStyle='#172f2c';
    const content=card.truncated&&!card.text.endsWith('…')?card.text+'…':card.text;
    const layout=misskeyCardLines(content,value=>x.measureText(value).width,472);
    layout.lines.forEach((line,i)=>x.fillText(line,20,92+i*27));
    x.font=`600 14px ${font}`;
    const tag=fitText('#'+hashtag,280,value=>x.measureText(value).width),width=x.measureText(tag).width+20;
    x.fillStyle='#e9f1d8';x.beginPath();x.roundRect(20,222,width,23,9);x.fill();
    x.fillStyle='#45602b';x.fillText(tag,30,239);
    x.fillStyle='#899893';x.font=`600 11px ${font}`;x.textAlign='right';x.fillText('MISSKEY',490,239);x.textAlign='left';
    slot.texture.needsUpdate=true;this.updates++;
  }
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;this.state=null;this.active=0;this.root.visible=false;
    for(const slot of this.slots.values()){
      slot.mesh.onBeforeRender=()=>{};slot.mesh.material.dispose();slot.texture.dispose();
      const canvas=slot.texture.image as HTMLCanvasElement;canvas.width=canvas.height=0;slot.card=null;
    }
    this.geometry.dispose();this.slots.clear();this.root.removeFromParent();this.root.clear();
  }
}
