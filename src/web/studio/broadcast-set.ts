import * as THREE from 'three';
/** Procedural discussion-set impression: amber panels, cool gray floor, navy signage. */
export class BroadcastSet extends THREE.Group {
 private rear=new THREE.Group();private floor:THREE.Mesh;private sides:THREE.Mesh[]=[];
 constructor(title:string,subtitle:string){
  super();
  const material=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.8});
  this.floor=new THREE.Mesh(new THREE.PlaneGeometry(24,1),material(0x8b8d87));this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-.045;this.add(this.floor,this.rear);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(20,7,.22),material(0x4d5464));wall.position.set(0,3.45,0);this.rear.add(wall);
  for(const side of [-1,1]){
   const wall=new THREE.Mesh(new THREE.BoxGeometry(.18,4,1),material(0x686d77));wall.position.set(side*7,1.95,0);this.add(wall);this.sides.push(wall);
   for(let i=0;i<3;i++){const rail=new THREE.Mesh(new THREE.BoxGeometry(.24,.16,1),material(i===1?0xd1c5a5:0xa88758));rail.position.set(side*6.86,.8+i*1.05,0);this.add(rail);this.sides.push(rail);}
  }
  for(const side of [-1,1])for(let i=0;i<4;i++){
   const panel=new THREE.Mesh(new THREE.BoxGeometry(.85,2.6+(i%2)*.5,.4),material([0xa46e43,0xc49960,0x744e36,0xb47c47][i]!));
   panel.position.set(side*(2.9+i*.82),1.5,-.08+(i%2)*.16);panel.rotation.z=side*(i%2?.15:-.13);panel.rotation.y=side*.25;this.rear.add(panel);
   const rail=new THREE.Mesh(new THREE.BoxGeometry(1.05,.15,.52),material(0xe4ddc8));rail.position.set(side*(3+i*.82),.65+(i%2)*.12,.25);this.rear.add(rail);
  }
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;const x=canvas.getContext('2d')!;
  const gradient=x.createRadialGradient(512,40,20,512,40,600);gradient.addColorStop(0,'#d99651');gradient.addColorStop(.46,'#805c48');gradient.addColorStop(1,'#313d57');x.fillStyle=gradient;x.fillRect(0,0,1024,320);
  x.textAlign='center';x.textBaseline='middle';let size=126;do{x.font=`700 ${size}px Meiryo,"Yu Gothic",sans-serif`;if(x.measureText(title).width<920)break;size-=4;}while(size>32);
  x.lineWidth=9;x.strokeStyle='#293444';x.strokeText(title,512,132);x.fillStyle='#eee7d2';x.fillText(title,512,132);x.font='600 42px system-ui';x.fillStyle='#ced3da';x.fillText(subtitle,512,253);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(5.9,1.84),new THREE.MeshBasicMaterial({map:texture}));sign.position.set(0,3.25,.13);this.rear.add(sign);
  const plinth=new THREE.Mesh(new THREE.BoxGeometry(5.5,.16,1.7),material(0xb7b2a1));plinth.position.set(0,.02,.8);this.rear.add(plinth);
  this.setLength(3);
 }
 setLength(length:number){this.rear.position.z=-length/2-3.7;this.floor.scale.y=length+14;for(const side of this.sides)side.scale.z=length+14;}
}
