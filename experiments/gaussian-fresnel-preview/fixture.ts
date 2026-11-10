import * as THREE from 'three';
import {PackedSplats} from '@sparkjsdev/spark';
/** Original procedural surface-aligned 3D Gaussians; NOT a trained scan.
 * Deliberately smooth normals are a best-case control for the rim experiment.
 */
export async function makeBust(jacket:[number,number,number]=[.20,.30,.45]){
 const packed=new PackedSplats();await packed.initialized;
 let seed=13807;
 const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const z=new THREE.Vector3(0,0,1),light=new THREE.Vector3(-.5,.8,1).normalize();
 function ellipsoid(center:number[],radii:number[],count:number,color:number[],predicate?:(u:THREE.Vector3)=>boolean,rotation=0,noise=.06){
  const orient=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),rotation);
  const surface=4*Math.PI*Math.pow(((radii[0]!*radii[1]!)**1.6075+(radii[1]!*radii[2]!)**1.6075+(radii[0]!*radii[2]!)**1.6075)/3,1/1.6075);
  const tangent=Math.sqrt(surface/count)*.50;
  for(let i=0;i<count;i++){
   const y=1-2*(i+.5)/count,a=i*2.399963229728653,rr=Math.sqrt(1-y*y);
   const dir=new THREE.Vector3(Math.cos(a)*rr,y,Math.sin(a)*rr);if(predicate&&!predicate(dir))continue;
   const p=new THREE.Vector3(dir.x*radii[0]!,dir.y*radii[1]!,dir.z*radii[2]!).applyQuaternion(orient).add(new THREE.Vector3().fromArray(center));
   const n=new THREE.Vector3(dir.x/radii[0]!,dir.y/radii[1]!,dir.z/radii[2]!).normalize().applyQuaternion(orient);
   const q=new THREE.Quaternion().setFromUnitVectors(z,n);
   const shade=.49+.43*Math.max(0,n.dot(light))+.08*Math.max(0,n.y);
   const jitter=1+(rand()-.5)*noise;
   const rgb=new THREE.Color().setRGB(color[0]!*shade*jitter,color[1]!*shade*jitter,color[2]!*shade*jitter);
   packed.pushSplat(p,new THREE.Vector3(tangent,tangent*.94,tangent*.16),q,.93,rgb);
  }
 }
 const skin=[.80,.61,.48],hair=[.19,.13,.10];
 ellipsoid([0,.67,0],[.40,.50,.25],7500,jacket);
 ellipsoid([0,.91,0],[.52,.235,.255],5200,jacket);
 ellipsoid([-.46,.61,.015],[.13,.37,.17],2000,jacket,undefined,-.15);
 ellipsoid([.46,.61,.015],[.13,.37,.17],2000,jacket,undefined,.15);
 ellipsoid([0,1.135,.01],[.115,.18,.12],1500,skin);
 ellipsoid([0,1.505,.02],[.248,.315,.235],6500,skin);
 ellipsoid([-.249,1.48,.012],[.048,.086,.046],650,skin);
 ellipsoid([.249,1.48,.012],[.048,.086,.046],650,skin);
 ellipsoid([0,1.535,.005],[.268,.332,.253],8000,hair,d=>d.y>.42||(d.z<.40&&d.y>-.55));
 ellipsoid([-.12,1.75,.15],[.15,.10,.12],1400,hair,undefined,-.24);
 ellipsoid([0,1.43,.252],[.036,.067,.065],650,skin);
 for(const x of [-.092,.092]){
  ellipsoid([x,1.525,.229],[.044,.016,.018],320,[.84,.84,.79]);
  ellipsoid([x,1.525,.244],[.012,.014,.007],120,[.07,.11,.12]);
  ellipsoid([x,1.571,.224],[.053,.010,.014],240,hair,undefined,x<0?-.07:.07);
 }
 ellipsoid([0,1.334,.224],[.071,.012,.022],360,[.56,.29,.25]);
 // Shirt opening and collar, also splats (no character triangle meshes).
 ellipsoid([0,1.02,.205],[.082,.105,.035],550,[.70,.72,.73]);
 for(const x of [-.10,.10])ellipsoid([x,1.044,.19],[.065,.06,.04],400,[.30,.37,.44],undefined,x<0?-.45:.45);
 return packed;
}
