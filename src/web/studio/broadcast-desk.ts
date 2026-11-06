import * as THREE from 'three';
import {createRingData,updateRingData} from '../../geometry/table-geometry-data.ts';
/** Pale timber, white edging and gray structural ribs; same mesh in preview/program. */
export class BroadcastDesk extends THREE.Group {
 private lastLength=NaN;
 private rings:Array<{data:ReturnType<typeof createRingData>;geometry:THREE.BufferGeometry;inner:number;outer:number;bottom:number;top:number}>=[];
 constructor(length=0){
  super();
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d')!;x.fillStyle='#d8c3a0';x.fillRect(0,0,256,256);
  for(let i=0;i<95;i++){const y=(i*83)%256;x.strokeStyle=`rgba(129,94,49,${.018+(i%5)*.008})`;x.lineWidth=1+(i%3)*.2;x.beginPath();x.moveTo(0,y);x.bezierCurveTo(70,y-3,150,y+2,256,y);x.stroke();}
  const wood=new THREE.CanvasTexture(c);wood.colorSpace=THREE.SRGBColorSpace;wood.wrapS=wood.wrapT=THREE.RepeatWrapping;wood.repeat.set(.9,1.4);wood.anisotropy=4;
  const parts=[
   [.72,1.44,.685,.758,0xf4f2e8], [.79,1.375,.744,.762,0xffffff],
   [.76,.86,.12,.685,0xb5b3ab], [1.12,1.24,.1,.685,0xc4c3bd], [.83,1.28,.025,.1,0x898c8b],
  ];
  parts.forEach(([inner,outer,bottom,top,color],i)=>{
   const data=createRingData(),geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(data.uvs,2));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
   this.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:i===1?.58:.72,metalness:.03,...(i===1?{map:wood}:{})})));
   this.rings.push({data,geometry,inner:inner!,outer:outer!,bottom:bottom!,top:top!});
  });this.update(length);
 }
 update(length:number):void {
  if(length===this.lastLength)return;this.lastLength=length;
  for(const r of this.rings){updateRingData(r.data,r.inner,r.outer,length,r.bottom,r.top);r.geometry.getAttribute('position').needsUpdate=true;r.geometry.getAttribute('normal').needsUpdate=true;r.geometry.computeBoundingSphere();}
 }
}
function monitorTexture():THREE.CanvasTexture {
 const c=document.createElement('canvas');c.width=256;c.height=144;const x=c.getContext('2d')!;
 x.fillStyle='#162b50';x.fillRect(0,0,256,144);x.fillStyle='#bfcbd6';x.fillRect(14,15,228,2);x.fillRect(14,126,228,2);
 x.font='600 36px system-ui';x.textAlign='center';x.fillStyle='#f3f1e5';x.fillText('ENTAKU',128,72);x.font='18px system-ui';x.fillStyle='#d6bc8b';x.fillText('DISCUSSION',128,101);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
/** Props are relative to the nameplate (world height .85m); no chairs. */
export function deskProps():THREE.Group {
 const root=new THREE.Group();
 const mesh=(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);root.add(o);return o;};
 mesh(new THREE.BoxGeometry(.19,.004,.25),new THREE.MeshStandardMaterial({color:0xf4f4ed}),-.04,-.086,-.21).rotation.y=.12;
 mesh(new THREE.CylinderGeometry(.04,.035,.11,16),new THREE.MeshPhysicalMaterial({color:0xe3d7b8,transparent:true,opacity:.4,roughness:.15,depthWrite:false}),.34,-.034,-.15);
 mesh(new THREE.CylinderGeometry(.033,.031,.07,16),new THREE.MeshStandardMaterial({color:0x9c551e,roughness:.22}),.34,-.052,-.15);
 mesh(new THREE.CylinderGeometry(.034,.04,.012,12),new THREE.MeshStandardMaterial({color:0x292c2c}),-.33,-.084,-.12);
 const mic=mesh(new THREE.CylinderGeometry(.006,.007,.20,8),new THREE.MeshStandardMaterial({color:0x333639}),-.33,.008,-.115);mic.rotation.x=-.2;
 mesh(new THREE.SphereGeometry(.017,8,6),new THREE.MeshStandardMaterial({color:0x202323}),-.33,.106,-.135);
 const screen=new THREE.Group();screen.position.set(-.5,-.025,.38);screen.rotation.x=-.35;root.add(screen);
 screen.add(new THREE.Mesh(new THREE.BoxGeometry(.30,.19,.022),new THREE.MeshStandardMaterial({color:0x323837})));
 const panel=new THREE.Mesh(new THREE.PlaneGeometry(.267,.153),new THREE.MeshBasicMaterial({map:monitorTexture()}));panel.position.z=.012;screen.add(panel);
 return root;
}
