import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {emptyMisskeyState,type MisskeyCard,type MisskeyState} from '../../src/contracts/misskey.ts';
import {MISSKEY_CARD_WIDTH,MISSKEY_CARD_HEIGHT,misskeyCardPosition} from '../../src/geometry/misskey-card-layout.ts';
import {MisskeyCards,MISSKEY_TEXTURE_BYTES,misskeyCardLines} from '../../src/web/overlay/misskey-cards.ts';

const measure=(text:string)=>[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)].length*20;
type CardMesh=THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
function renderCard(scene:THREE.Scene,mesh:CardMesh,camera:THREE.Camera):THREE.Matrix4 {
  scene.updateMatrixWorld(true);camera.updateWorldMatrix(true,false);
  mesh.onBeforeRender({} as THREE.WebGLRenderer,scene,camera,mesh.geometry,mesh.material,mesh.parent as THREE.Group);
  return mesh.matrixWorld.clone();
}
const basis=(matrix:THREE.Matrix4,column:number)=>new THREE.Vector3().setFromMatrixColumn(matrix,column).normalize();
function expectMatrix(actual:THREE.Matrix4,expected:THREE.Matrix4):void{actual.elements.forEach((n,i)=>expect(n).toBeCloseTo(expected.elements[i]!,10));}
function expectScreenParallel(matrix:THREE.Matrix4,camera:THREE.Camera):void {
  const modelView=new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,matrix);
  for(let axis=0;axis<3;axis++)expect(basis(modelView,axis).distanceTo(new THREE.Vector3().setComponent(axis,1))).toBeLessThan(1e-10);
  // Check the projected rectangle as well as its normal: a point-facing
  // lookAt can look correct at screen center but skews cards near the edges.
  const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y])=>new THREE.Vector3(x,y,0).applyMatrix4(modelView));
  const depths=corners.map(corner=>corner.z);expect(Math.max(...depths)-Math.min(...depths)).toBeLessThan(1e-10);
  const [bottomLeft,bottomRight,topRight,topLeft]=corners.map(corner=>corner.applyMatrix4(camera.projectionMatrix));
  expect(bottomRight!.y).toBeCloseTo(bottomLeft!.y,10);expect(topRight!.y).toBeCloseTo(topLeft!.y,10);
  expect(topLeft!.x).toBeCloseTo(bottomLeft!.x,10);expect(topRight!.x).toBeCloseTo(bottomRight!.x,10);
  expect(bottomRight!.x).toBeGreaterThan(bottomLeft!.x);expect(topLeft!.y).toBeGreaterThan(bottomLeft!.y);
}
function canvasFactory():HTMLCanvasElement {
  const context=new Proxy({measureText:(value:string)=>({width:measure(value)})}, {get:(target,key)=>Reflect.get(target,key)??(()=>{})});
  return {width:0,height:0,getContext:()=>context} as unknown as HTMLCanvasElement;
}
function card(slot=0,now=1000):MisskeyCard {
  return {id:`note-${slot}`,userId:`user-${slot}`,username:`author${slot}`,authorName:`投稿者${slot}`,text:'会場のみなさん、よろしくお願いします！',url:`https://otomad.site/notes/note-${slot}`,createdAt:new Date(now).toISOString(),shownAt:now,expiresAt:now+30000,slot,truncated:false};
}
function state(cards:MisskeyCard[]):MisskeyState{return {...emptyMisskeyState(),status:'live',cards};}

test('line wrapping preserves Japanese combining characters and emoji sequences with a bounded ellipsis',()=>{
  const family='👩‍👩‍👧‍👦',kana='か\u3099';
  expect(misskeyCardLines(family.repeat(3)+kana.repeat(3),measure,60,3)).toEqual({lines:[family.repeat(3),kana.repeat(3)],truncated:false});
  const long=misskeyCardLines('あいうえおかきくけこさしすせそ',measure,60,2);
  expect(long).toEqual({lines:['あいう','えお…'],truncated:true});
  expect(long.lines.every(line=>measure(line)<=60)).toBe(true);
  expect(misskeyCardLines('あ\nい\n',measure,60,2)).toEqual({lines:['あ','い'],truncated:false});
  expect(misskeyCardLines('あ\nい\nう',measure,60,2)).toEqual({lines:['あ','い…'],truncated:true});
  expect(misskeyCardLines('A shared room',measure,120,3)).toEqual({lines:['A','shared','room'],truncated:false});
  expect(misskeyCardLines('あいう。え',measure,60,3)).toEqual({lines:['あい','う。え'],truncated:false});
  expect(misskeyCardLines('あい（う',measure,60,3)).toEqual({lines:['あい','（う'],truncated:false});
});

test('animation and counter-only updates never redraw text; changed content reuses its fixed texture',()=>{
  const view=new MisskeyCards(canvasFactory),initial=state([card()]);view.setState(initial);view.prepare(6,0,true,2000);
  const mesh=view.root.children[0] as CardMesh,texture=mesh.material.map!;
  expect(view.stats).toEqual({visible:1,allocated:1,textures:1,textureBytes:MISSKEY_TEXTURE_BYTES,textureUpdates:1});
  for(let frame=0;frame<200;frame++)view.prepare(6,0,true,2000+frame*16);
  view.setState({...initial,received:99});view.prepare(6,0,true,6000);
  expect(view.stats.textureUpdates).toBe(1);
  view.setState(state([{...card(),text:'新しいメッセージ'}]));view.prepare(6,0,true,6000);
  expect(view.stats.textureUpdates).toBe(2);expect(mesh.material.map).toBe(texture);
  expect(texture.generateMipmaps).toBe(false);expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(mesh).toBeInstanceOf(THREE.Mesh);expect(mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry);expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  expect(mesh.layers.isEnabled(1)).toBe(true);expect(mesh.layers.isEnabled(0)).toBe(false);
  expect(mesh.material.toneMapped).toBe(false);expect(mesh.material.depthTest).toBe(true);expect(mesh.material.depthWrite).toBe(false);
  expect(mesh.renderOrder).toBe(-1);expect(mesh.material.side).toBe(THREE.FrontSide);expect(mesh.frustumCulled).toBe(false);
  view.dispose();
});

test('30-slot churn shares one plane and dispose releases it plus every material, texture, and canvas',()=>{
  const view=new MisskeyCards(canvasFactory);
  for(let batch=0;batch<12;batch++){
    view.setState(state(Array.from({length:30},(_,slot)=>({...card(slot),id:`batch-${batch}-${slot}`}))));
    view.prepare(6,2,true,2000+batch*100);
  }
  expect(view.stats.allocated).toBe(30);expect(view.stats.textureBytes).toBe(15*1024*1024);expect(view.stats.textureUpdates).toBe(360);
  const canvases:HTMLCanvasElement[]=[],geometries=new Set<THREE.PlaneGeometry>();let textures=0,materials=0,geometryDisposals=0;
  for(const child of view.root.children){const mesh=child as CardMesh;const texture=mesh.material.map!;
    geometries.add(mesh.geometry);texture.addEventListener('dispose',()=>textures++);mesh.material.addEventListener('dispose',()=>materials++);
    canvases.push(texture.image as HTMLCanvasElement);
  }
  expect(geometries.size).toBe(1);for(const geometry of geometries){expect(geometry.index!.count).toBe(6);geometry.addEventListener('dispose',()=>geometryDisposals++);}
  view.dispose();view.dispose();
  expect(textures).toBe(30);expect(materials).toBe(30);expect(geometryDisposals).toBe(1);expect(canvases.every(canvas=>canvas.width===0&&canvas.height===0)).toBe(true);
  expect(view.stats.allocated).toBe(0);expect(view.root.children).toHaveLength(0);
});

test('wall time expires cards even without more network data; stale, clear, and pause hide immediately',()=>{
  const view=new MisskeyCards(canvasFactory),initial=state([card()]);view.setState(initial);view.prepare(6,0,true,2000);
  expect(view.stats.visible).toBe(1);
  view.prepare(6,0,false,2100);expect(view.root.visible).toBe(false);expect(view.stats.visible).toBe(0);
  view.prepare(6,0,true,2200);expect(view.stats.visible).toBe(1);
  view.setState({...initial,paused:true});expect(view.root.visible).toBe(false);
  view.setState(initial);view.prepare(6,0,true,31000);expect(view.stats.visible).toBe(0);
  view.setState(null);expect(view.root.visible).toBe(false);expect(view.stats.visible).toBe(0);
  view.dispose();
});

test('a future card replacing a reused slot paints only once its wall-clock lifetime begins',()=>{
  const view=new MisskeyCards(canvasFactory);view.setState(state([card()]));view.prepare(6,0,true,2000);
  view.setState(state([{...card(0,3000),id:'future',text:'次のノート'}]));view.prepare(6,0,true,2500);
  expect(view.stats.textureUpdates).toBe(1);expect(view.stats.visible).toBe(0);
  view.prepare(6,0,true,4000);expect(view.stats.textureUpdates).toBe(2);expect(view.stats.visible).toBe(1);
  view.dispose();
});

test('opposite SPLIT cameras and a transformed stage each get the correct near-side suppression',()=>{
  const view=new MisskeyCards(canvasFactory);view.setState(state([card()]));view.prepare(6,2,true,2000);
  const scene=new THREE.Scene(),stage=new THREE.Group();scene.add(stage);stage.add(view.root);stage.position.set(12,4,-6);stage.rotation.y=.7;scene.updateMatrixWorld(true);
  const mesh=view.root.children[0] as CardMesh,p=misskeyCardPosition(0,6,2),camera=new THREE.PerspectiveCamera();
  const renderAt=(inward:number)=>{
    camera.position.set(p.x+p.inwardX*inward,p.y,p.z+p.inwardZ*inward).applyMatrix4(view.root.matrixWorld);camera.updateMatrixWorld(true);
    renderCard(scene,mesh,camera);return mesh.material.opacity;
  };
  expect(renderAt(-2)).toBe(0);expect(renderAt(2)).toBe(1);expect(renderAt(-2)).toBe(0);
  view.dispose();
});

test('center and edge cards stay screen-parallel through camera motion, roll, and reversed SPLIT order',()=>{
  const view=new MisskeyCards(canvasFactory);view.setState(state([card()]));view.prepare(0,0,true,2000);
  const scene=new THREE.Scene();scene.add(view.root);const mesh=view.root.children[0] as CardMesh;
  const p=misskeyCardPosition(0,0),center=mesh.position.clone(),normal=new THREE.Vector3(p.inwardX,0,p.inwardZ),tangent=new THREE.Vector3(-p.inwardZ,0,p.inwardX);
  const camera=(side:number)=>{const c=new THREE.PerspectiveCamera(48,16/9,.05,100);c.position.copy(center).addScaledVector(normal,3).addScaledVector(tangent,side);c.lookAt(center);return c;};
  const a=camera(-1.5),b=camera(1.5),firstA=renderCard(scene,mesh,a),firstB=renderCard(scene,mesh,b);
  expectMatrix(renderCard(scene,mesh,b),firstB);expectMatrix(renderCard(scene,mesh,a),firstA);
  expectScreenParallel(firstA,a);expectScreenParallel(firstB,b);
  expect(basis(firstA,2).dot(basis(firstB,2))).toBeLessThan(.9);
  for(const yaw of [-.32,0,.32]){
    const offCenter=camera(0);offCenter.rotateY(yaw);
    expectScreenParallel(renderCard(scene,mesh,offCenter),offCenter);
    const projected=center.clone().project(offCenter);
    if(yaw===0)expect(Math.hypot(projected.x,projected.y)).toBeLessThan(1e-10);
    else expect(Math.abs(projected.x)).toBeGreaterThan(.4);
  }
  let previous=basis(firstA,2);
  for(let step=1;step<=20;step++){
    const moving=camera(-1.5+3*step/20),matrix=renderCard(scene,mesh,moving),current=basis(matrix,2);
    expectScreenParallel(matrix,moving);
    expect(previous.angleTo(current)).toBeLessThan(.06);previous=current;
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(center)).toBeLessThan(1e-10);
  }
  a.rotateZ(.45);const rolled=renderCard(scene,mesh,a);expect(basis(rolled,1).dot(basis(firstA,1))).toBeLessThan(.95);expectScreenParallel(rolled,a);
  const fixedTime=renderCard(scene,mesh,a);view.prepare(0,0,true,6000);const later=renderCard(scene,mesh,a);
  for(let axis=0;axis<3;axis++)expect(basis(fixedTime,axis).distanceTo(basis(later,axis))).toBeLessThan(1e-10);
  expectScreenParallel(later,a);
  expect(new THREE.Vector3().setFromMatrixPosition(later).distanceTo(new THREE.Vector3().setFromMatrixPosition(fixedTime))).toBeGreaterThan(.001);
  expect(view.stats.textureUpdates).toBe(1);view.dispose();
});

test('non-uniform parent scale and parented cameras preserve the world center and screen-parallel axes',()=>{
  const view=new MisskeyCards(canvasFactory);view.setState(state([card()]));view.prepare(6,2,true,2000);
  const scene=new THREE.Scene(),stage=new THREE.Group(),rig=new THREE.Group();scene.add(stage,rig);stage.add(view.root);
  stage.position.set(12,4,-6);stage.rotation.set(.2,.7,-.1);stage.scale.set(1.7,.75,2.3);
  view.root.rotation.y=.25;rig.position.set(-4,2,8);rig.rotation.set(.1,-.4,.2);scene.updateMatrixWorld(true);
  const mesh=view.root.children[0] as CardMesh,p=misskeyCardPosition(0,6,2),center=mesh.position.clone().applyMatrix4(view.root.matrixWorld);
  const worldCamera=new THREE.Vector3(p.x+p.inwardX*4,p.y+.8,p.z+p.inwardZ*4).applyMatrix4(view.root.matrixWorld),camera=new THREE.PerspectiveCamera();rig.add(camera);
  camera.position.copy(worldCamera).applyMatrix4(rig.matrixWorld.clone().invert());camera.lookAt(center);
  const rendered=renderCard(scene,mesh,camera),x=basis(rendered,0),y=basis(rendered,1),z=basis(rendered,2);
  expect(mesh.material.opacity).toBe(1);expect(new THREE.Vector3().setFromMatrixPosition(rendered).distanceTo(center)).toBeLessThan(1e-9);
  expect(Math.abs(x.dot(y))).toBeLessThan(1e-10);expect(Math.abs(x.dot(z))).toBeLessThan(1e-10);expect(Math.abs(y.dot(z))).toBeLessThan(1e-10);
  expectScreenParallel(rendered,camera);
  expect(new THREE.Vector3().setFromMatrixColumn(rendered,0).length()).toBeCloseTo(MISSKEY_CARD_WIDTH*new THREE.Vector3().setFromMatrixColumn(view.root.matrixWorld,0).length(),10);
  expect(new THREE.Vector3().setFromMatrixColumn(rendered,1).length()).toBeCloseTo(MISSKEY_CARD_HEIGHT*new THREE.Vector3().setFromMatrixColumn(view.root.matrixWorld,1).length(),10);
  scene.updateMatrixWorld(true);expectMatrix(mesh.matrixWorld,rendered);
  // A later parent move must use the new world matrix, not the cached inverse.
  stage.rotation.y=-.45;stage.scale.set(.8,1.6,1.1);scene.updateMatrixWorld(true);
  const movedCenter=mesh.position.clone().applyMatrix4(view.root.matrixWorld);camera.position.copy(movedCenter).add(new THREE.Vector3(0,2,6)).applyMatrix4(rig.matrixWorld.clone().invert());camera.lookAt(movedCenter);
  const moved=renderCard(scene,mesh,camera);expect(new THREE.Vector3().setFromMatrixPosition(moved).distanceTo(movedCenter)).toBeLessThan(1e-9);
  expect(Math.abs(basis(moved,0).dot(basis(moved,1)))).toBeLessThan(1e-10);expectScreenParallel(moved,camera);view.dispose();
});
