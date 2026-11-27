import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {emptyMisskeyState,type MisskeyCard,type MisskeyState} from '../../src/contracts/misskey.ts';
import {misskeyCardPosition} from '../../src/geometry/misskey-card-layout.ts';
import {MisskeyCards,MISSKEY_TEXTURE_BYTES,misskeyCardLines} from '../../src/web/overlay/misskey-cards.ts';

const measure=(text:string)=>[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)].length*20;
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
  const sprite=view.root.children[0] as THREE.Sprite,texture=sprite.material.map!;
  expect(view.stats).toEqual({visible:1,allocated:1,textures:1,textureBytes:MISSKEY_TEXTURE_BYTES,textureUpdates:1});
  for(let frame=0;frame<200;frame++)view.prepare(6,0,true,2000+frame*16);
  view.setState({...initial,received:99});view.prepare(6,0,true,6000);
  expect(view.stats.textureUpdates).toBe(1);
  view.setState(state([{...card(),text:'新しいメッセージ'}]));view.prepare(6,0,true,6000);
  expect(view.stats.textureUpdates).toBe(2);expect(sprite.material.map).toBe(texture);
  expect(texture.generateMipmaps).toBe(false);expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(sprite.layers.isEnabled(1)).toBe(true);expect(sprite.layers.isEnabled(0)).toBe(false);
  expect(sprite.material.toneMapped).toBe(false);expect(sprite.material.depthTest).toBe(true);expect(sprite.material.depthWrite).toBe(false);
  expect(sprite.renderOrder).toBe(-1);
  view.dispose();
});

test('30-slot churn stays at 15 MiB and dispose releases every material, texture, and canvas',()=>{
  const view=new MisskeyCards(canvasFactory);
  for(let batch=0;batch<12;batch++){
    view.setState(state(Array.from({length:30},(_,slot)=>({...card(slot),id:`batch-${batch}-${slot}`}))));
    view.prepare(6,2,true,2000+batch*100);
  }
  expect(view.stats.allocated).toBe(30);expect(view.stats.textureBytes).toBe(15*1024*1024);expect(view.stats.textureUpdates).toBe(360);
  const canvases:HTMLCanvasElement[]=[];let textures=0,materials=0;
  for(const child of view.root.children){const sprite=child as THREE.Sprite;const texture=sprite.material.map!;
    texture.addEventListener('dispose',()=>textures++);sprite.material.addEventListener('dispose',()=>materials++);
    canvases.push(texture.image as HTMLCanvasElement);
  }
  view.dispose();view.dispose();
  expect(textures).toBe(30);expect(materials).toBe(30);expect(canvases.every(canvas=>canvas.width===0&&canvas.height===0)).toBe(true);
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
  const sprite=view.root.children[0] as THREE.Sprite,p=misskeyCardPosition(0,6,2),camera=new THREE.PerspectiveCamera();
  const renderAt=(inward:number)=>{
    camera.position.set(p.x+p.inwardX*inward,p.y,p.z+p.inwardZ*inward).applyMatrix4(view.root.matrixWorld);camera.updateMatrixWorld(true);
    sprite.onBeforeRender({} as THREE.WebGLRenderer,scene,camera,sprite.geometry,sprite.material,view.root);
    return sprite.material.opacity;
  };
  expect(renderAt(-2)).toBe(0);expect(renderAt(2)).toBe(1);expect(renderAt(-2)).toBe(0);
  view.dispose();
});
