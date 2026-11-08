import * as THREE from 'three';
import {NAMEPLATE} from '../../geometry/desk-props.ts';
import {protectDisplayObject} from './exposure-renderer.ts';
/** An actual trapezoidal cross-section, with separately oriented front/back prints. */
export class NameplateVisual extends THREE.Group {
 private texture:THREE.CanvasTexture;private printed:THREE.MeshBasicMaterial;
 private current='';private style='';
 constructor(name:string,style='white'){
  super();this.name='ENTAKU double-sided nameplate';
  const {width,height,baseDepth,topDepth}=NAMEPLATE;
  const profile=new THREE.Shape();profile.moveTo(-baseDepth/2,0);profile.lineTo(baseDepth/2,0);profile.lineTo(topDepth/2,height);profile.lineTo(-topDepth/2,height);profile.closePath();
  const geometry=new THREE.ExtrudeGeometry(profile,{depth:width,bevelEnabled:false,steps:1,curveSegments:1});geometry.translate(0,0,-width/2);geometry.rotateY(Math.PI/2);
  const body=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xf8f6ed,roughness:.65}));this.add(body);
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=384;
  this.texture=new THREE.CanvasTexture(canvas);this.texture.colorSpace=THREE.SRGBColorSpace;this.texture.anisotropy=8;
  this.printed=new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const lean=Math.atan((baseDepth-topDepth)/(2*height)),slope=Math.hypot(height,(baseDepth-topDepth)/2);
  for(const side of [-1,1]){
   const face=new THREE.Mesh(new THREE.PlaneGeometry(width-.014,slope-.012),this.printed);
   face.name=side===1?'Name facing discussion':'Name facing participant';
   face.position.set(0,height/2,(baseDepth+topDepth)/4*side+side*.001);
   face.rotation.set(side===1?-lean:lean,side===1?0:Math.PI,0);this.add(face);
  }
  protectDisplayObject(this);body.layers.set(0);body.castShadow=body.receiveShadow=true;this.setName(name,style);
 }
 setName(name:string,style='white'):void{
  if(name===this.current&&style===this.style)return;this.current=name;this.style=style;
  const c=this.texture.image as HTMLCanvasElement,x=c.getContext('2d')!;
  x.fillStyle=style==='blue'?'#123d80':'#faf8f0';x.fillRect(0,0,c.width,c.height);
  const text=[...name].slice(0,32).join('')||'—';
  x.font='900 264px "Yu Gothic","Meiryo","Noto Sans CJK JP",sans-serif';
  x.fillStyle=style==='blue'?'#ffffff':'#123d80';x.strokeStyle=x.fillStyle;x.lineWidth=1.3;x.textAlign='left';x.textBaseline='middle';
  const width=c.width-56,actual=x.measureText(text).width;
  x.save();x.translate(28,c.height*.52);x.scale(width/Math.max(1,actual),1);x.fillText(text,0,0);x.strokeText(text,0,0);x.restore();
  this.texture.needsUpdate=true;
 }
}
