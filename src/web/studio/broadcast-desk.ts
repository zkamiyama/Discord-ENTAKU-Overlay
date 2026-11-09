import * as THREE from 'three';
import {MICROPHONE} from '../../geometry/desk-props.ts';
import {createRingData,updateRingData} from '../../geometry/table-geometry-data.ts';
/** Continuous lacquered timber top, dark edge trim and gray structural ribs; same mesh in preview/program. */
export class BroadcastDesk extends THREE.Group {
 private lastLength=NaN;
 private rings:Array<{data:ReturnType<typeof createRingData>;geometry:THREE.BufferGeometry;inner:number;outer:number;bottom:number;top:number}>=[];
 constructor(length=0){
  super();this.userData.entakuDesk=true;
  const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d')!;
  x.fillStyle='#985b2d';x.fillRect(0,0,c.width,c.height);
  // Periodic analytic grain repeats without random changes when the table grows.
  for(let y=0;y<c.height;y++){
   const grain=Math.sin(y*.83+Math.sin(y*.033)*3)*.5+Math.sin(y*.19)*.28;
   x.strokeStyle=grain>0?`rgba(72,34,10,${.04+grain*.15})`:`rgba(243,195,121,${.04-grain*.13})`;x.lineWidth=1;
   x.beginPath();for(let u=0;u<=c.width;u+=8){const v=y+Math.sin(u*Math.PI*2/c.width+y*.013)*2.5;u?x.lineTo(u,v):x.moveTo(u,v);}x.stroke();
  }
  const wood=new THREE.CanvasTexture(c);wood.colorSpace=THREE.SRGBColorSpace;wood.wrapS=wood.wrapT=THREE.RepeatWrapping;wood.repeat.set(.75,.75);wood.anisotropy=8;
  const bump=wood.clone();bump.colorSpace=THREE.NoColorSpace;
  const parts=[
   [.72,1.44,.685,.762,0xffffff], [.719,1.441,.708,.720,0x393129],
   [.76,.86,.12,.685,0xb5b3ab], [1.12,1.24,.1,.685,0xc4c3bd], [.83,1.28,.025,.1,0x898c8b],
  ];
  parts.forEach(([inner,outer,bottom,top,color],i)=>{
   const data=createRingData(),geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(data.uvs,2));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
   this.add(new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({color,roughness:i===0?.20:.72,metalness:0,...(i===0?{map:wood,bumpMap:bump,bumpScale:.00045,clearcoat:.95,clearcoatRoughness:.10}:{})})));
   const mesh=this.children.at(-1) as THREE.Mesh;mesh.castShadow=mesh.receiveShadow=true;if(i===0){mesh.userData.entakuReflective=true;mesh.userData.entakuWoodTop=true;mesh.name='Continuous lacquered wood top';}
   this.rings.push({data,geometry,inner:inner!,outer:outer!,bottom:bottom!,top:top!});
  });this.update(length);
 }
 update(length:number):void {
  if(length===this.lastLength)return;this.lastLength=length;
  for(const r of this.rings){updateRingData(r.data,r.inner,r.outer,length,r.bottom,r.top);r.geometry.getAttribute('position').needsUpdate=true;r.geometry.getAttribute('normal').needsUpdate=true;r.geometry.getAttribute('uv').needsUpdate=true;r.geometry.computeBoundingSphere();r.geometry.computeBoundingBox();}
 }
}
/** Weighted gooseneck microphone; all parts stay over the tabletop. No cup or monitor. */
export function deskProps():THREE.Group {
 const root=new THREE.Group();root.name='Desk microphone';
 const black=new THREE.MeshStandardMaterial({color:0x222527,roughness:.65,metalness:.18});
 const metal=new THREE.MeshStandardMaterial({color:0x4e5356,roughness:.38,metalness:.65});
 const add=(g:THREE.BufferGeometry,m:THREE.Material,p:THREE.Vector3)=>{const mesh=new THREE.Mesh(g,m);mesh.position.copy(p);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;};
 const {x,z,baseRadius}=MICROPHONE;
 add(new THREE.CylinderGeometry(baseRadius*.84,baseRadius,.022,24),black,new THREE.Vector3(x,.011,z));
 add(new THREE.CylinderGeometry(.016,.019,.025,16),metal,new THREE.Vector3(x,.033,z));
 const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,.043,z),new THREE.Vector3(x,.15,z-.006),new THREE.Vector3(x+.015,.245,z-.035),new THREE.Vector3(x+.035,.27,z-.10)]);
 add(new THREE.TubeGeometry(curve,24,.0055,8,false),black,new THREE.Vector3());
 const end=curve.getPoint(1),direction=curve.getTangent(1).normalize();
 const capsule=add(new THREE.CapsuleGeometry(.012,.044,4,10),black,end.clone().addScaledVector(direction,.023));capsule.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
 for(let i=0;i<4;i++){const band=add(new THREE.TorusGeometry(.0121,.0008,4,12),metal,end.clone().addScaledVector(direction,.025+i*.006));band.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);}
 add(new THREE.BoxGeometry(.013,.0015,.007),new THREE.MeshStandardMaterial({color:0x475953,roughness:.6}),new THREE.Vector3(x,.023,z+.03));
 return root;
}
