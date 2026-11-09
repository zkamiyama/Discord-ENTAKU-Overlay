import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {StudioVisual} from '../../src/web/studio/visual.ts';
import {DEFAULT_STUDIO_SCENE,type StudioScene} from '../../src/studio/manifest.ts';
import type {StudioClient} from '../../src/web/shared/client.ts';

function scene(id:string):StudioScene {
  return {...DEFAULT_STUDIO_SCENE,broadcast:{enabled:false,title:'',subtitle:''},objects:[{id,kind:'model',bundleId:id,transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}}]};
}
function asset(){
  const group=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);group.add(new THREE.Mesh(geometry,material),new THREE.PointLight());
  return {group,disposed:()=>disposed};
}
const client={} as StudioClient,renderer={} as THREE.WebGLRenderer;
test('failed replacement retains active geometry, lighting and definition',async()=>{
  const first=asset(),partial=asset();let calls=0;
  const visual=new StudioVisual(client,renderer,async()=>{if(++calls===1)return first.group;if(calls===2)return partial.group;throw Error('STUDIO_TEXTURE_LOAD_FAILED');});
  await visual.update(scene('one'));const generation=visual.renderGeneration;
  const candidate=scene('two');candidate.objects.push({...candidate.objects[0]!,id:'failing'});
  await visual.update(candidate);
  expect(visual.error).toBe('STUDIO_TEXTURE_LOAD_FAILED');expect(visual.readyForCamera).toBe(true);
  expect(visual.authoredLights).toBe(1);expect(visual.renderGeneration).toBe(generation);
  expect(visual.setLength(1)).toBe('STUDIO_LOAD_FAILED');expect(visual.root.visible).toBe(true);
  expect(first.disposed()).toBe(0);expect(partial.disposed()).toBe(1);visual.dispose();expect(first.disposed()).toBe(1);
});
test('out-of-order candidates and dispose cannot attach late-loaded resources',async()=>{
  const pending=new Map<string,(value:THREE.Group)=>void>();
  const visual=new StudioVisual(client,renderer,async(_c,_r,id)=>new Promise(resolve=>pending.set(id,resolve)));
  const old=visual.update(scene('old')),latest=visual.update(scene('latest'));
  const a=asset(),b=asset();pending.get('latest')!(b.group);await latest;pending.get('old')!(a.group);await old;
  expect(a.disposed()).toBe(1);expect(b.disposed()).toBe(0);expect(visual.root.children).toHaveLength(1);expect(visual.renderGeneration).toBe(1);
  const later=visual.update(scene('disposed')),c=asset();visual.dispose();pending.get('disposed')!(c.group);await later;
  expect(c.disposed()).toBe(1);expect(b.disposed()).toBe(1);expect(visual.readyForCamera).toBe(false);expect(visual.root.children).toHaveLength(0);
});
test('active scene stays visible while loading and old resources release once on success',async()=>{
  const a=asset(),b=asset();let resolve!:(value:THREE.Group)=>void;
  const visual=new StudioVisual(client,renderer,async(_c,_r,id)=>id==='first'?a.group:new Promise(r=>{resolve=r;}));
  await visual.update(scene('first'));const next=visual.update(scene('next'));
  expect(visual.setLength(1)).toBe('STUDIO_LOADING');expect(visual.root.visible).toBe(true);expect(visual.readyForCamera).toBe(true);expect(a.disposed()).toBe(0);
  resolve(b.group);await next;expect(a.disposed()).toBe(1);expect(visual.renderGeneration).toBe(2);expect(visual.error).toBe('');
  await visual.update(scene('next'));expect(visual.renderGeneration).toBe(2);visual.dispose();visual.dispose();expect(b.disposed()).toBe(1);
});
