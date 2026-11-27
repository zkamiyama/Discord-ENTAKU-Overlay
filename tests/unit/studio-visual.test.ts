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
  const original=scene('one');await visual.update(original);const generation=visual.renderGeneration;
  const candidate=scene('two');candidate.objects.push({...candidate.objects[0]!,id:'failing',bundleId:'failing'} as StudioScene['objects'][number]);
  await visual.update(candidate);
  expect(visual.error).toBe('STUDIO_TEXTURE_LOAD_FAILED');expect(visual.readyForCamera).toBe(true);
  expect(visual.matchesRequested).toBe(false);expect(visual.definition).toBe(original);
  expect(visual.authoredLights).toBe(1);expect(visual.renderGeneration).toBe(generation);
  expect(visual.setLength(1)).toBe('STUDIO_LOAD_FAILED');expect(visual.root.visible).toBe(true);
  expect(first.disposed()).toBe(0);expect(partial.disposed()).toBe(1);visual.dispose();expect(first.disposed()).toBe(1);
});
test('out-of-order candidates and dispose cannot attach late-loaded resources',async()=>{
  const pending=new Map<string,(value:THREE.Group)=>void>();
  const visual=new StudioVisual(client,renderer,async(_c,_r,id)=>new Promise(resolve=>pending.set(id,resolve)));
  const old=visual.update(scene('old'));await Promise.resolve();
  const latest=visual.update(scene('latest'));await Promise.resolve();
  const a=asset(),b=asset();pending.get('latest')!(b.group);await latest;pending.get('old')!(a.group);await old;await Bun.sleep(0);
  expect(a.disposed()).toBe(1);expect(b.disposed()).toBe(0);expect(visual.root.children).toHaveLength(1);expect(visual.renderGeneration).toBe(1);
  const later=visual.update(scene('disposed')),c=asset();await Promise.resolve();visual.dispose();pending.get('disposed')!(c.group);await later;await Bun.sleep(0);
  expect(c.disposed()).toBe(1);expect(b.disposed()).toBe(1);expect(visual.readyForCamera).toBe(false);expect(visual.root.children).toHaveLength(0);
});
test('active scene stays visible while loading and old resources release once on success',async()=>{
  const a=asset(),b=asset();let resolve!:(value:THREE.Group)=>void;
  const visual=new StudioVisual(client,renderer,async(_c,_r,id)=>id==='first'?a.group:new Promise(r=>{resolve=r;}));
  const first=scene('first'),definition=scene('next');await visual.update(first);const next=visual.update(definition);
  expect(visual.setLength(1)).toBe('STUDIO_LOADING');expect(visual.root.visible).toBe(true);expect(visual.readyForCamera).toBe(true);expect(a.disposed()).toBe(0);
  expect(visual.matchesRequested).toBe(false);expect(visual.definition).toBe(first);
  await Promise.resolve();resolve(b.group);await next;expect(a.disposed()).toBe(1);expect(visual.renderGeneration).toBe(2);expect(visual.error).toBe('');
  expect(visual.matchesRequested).toBe(true);expect(visual.definition).toBe(definition);
  await visual.update(scene('next'));expect(visual.renderGeneration).toBe(2);visual.dispose();visual.dispose();expect(b.disposed()).toBe(1);
});

test('studio GLB speaker binding follows voice and presence, and releases glow shells on replacement',async()=>{
 const a=asset(),b=asset();const sourceMesh=a.group.children[0] as THREE.Mesh;
 let called=0;
 const visual=new StudioVisual(client,renderer,async()=>++called===1?a.group:b.group);
 const bound=scene('actor');bound.objects=[{...bound.objects[0]!,speakerUserId:'100'} as any];
 await visual.update(bound);expect(visual.meshSpeechCount).toBe(1);
 const instance=visual.root.children[0]!.children[0]!,firstMesh=instance.children[0] as THREE.Mesh;
 const material=firstMesh.material as THREE.MeshBasicMaterial;
 expect(firstMesh.geometry).toBe(sourceMesh.geometry);expect(material).not.toBe(sourceMesh.material);
 expect(visual.setLength(1)).toBe('READY');expect(visual.hasMeshSpeaker('100')).toBe(true);
 expect(visual.hasMeshSpeaker('101')).toBe(false);
 expect(firstMesh.children.filter(c=>c.userData.entakuMeshSpeechOutline)).toHaveLength(2);
 const states=new Map([['100',{visible:true,opacity:.45,intensity:1}]]);
 visual.setMeshSpeech(states,4);expect(visual.activeMeshSpeakers).toBe(1);
 expect(material.opacity).toBeCloseTo(.45);expect(material.transparent).toBe(true);
 visual.setMeshSpeech(new Map(),4);expect(visual.activeMeshSpeakers).toBe(0);
 expect(instance.visible).toBe(false);expect(a.group.visible).toBe(true);
 const plain=scene('next');await visual.update(plain);
 expect(visual.meshSpeechCount).toBe(0);expect(a.disposed()).toBe(1);
 expect(visual.activeMeshSpeakers).toBe(0);
 visual.dispose();expect(b.disposed()).toBe(1);
});

test('Gaussian LoD budget changes do not reload or dispose the studio scene',async()=>{
  const a=asset();let calls=0;
  const visual=new StudioVisual(client,renderer,async()=>{calls++;return a.group;});
  try{
    const first={...scene('one'),gaussian:{lodSplatCount:500_000}};
    await visual.update(first);
    const generation=visual.renderGeneration;
    await visual.update({...first,revision:1,gaussian:{lodSplatCount:1_000_000}});
    expect(calls).toBe(1);expect(visual.renderGeneration).toBe(generation);
    expect(a.disposed()).toBe(0);expect(visual.readyForCamera).toBe(true);
  }finally{visual.dispose();}
  expect(a.disposed()).toBe(1);
});

test('mesh presence invalidates shadow/receiver visibility only on a transition',async()=>{
 const a=asset(),visual=new StudioVisual(client,renderer,async()=>a.group);
 const bound=scene('actor');bound.objects=[{...bound.objects[0]!,speakerUserId:'100'} as any];
 try{
  await visual.update(bound);visual.setLength(1);
  const generation=visual.renderGeneration,revision=visual.meshVisibilityRevision;
  visual.setMeshSpeech(new Map(),4);
  expect(visual.meshVisibilityRevision).toBe(revision+1);
  visual.setMeshSpeech(new Map(),4);
  expect(visual.meshVisibilityRevision).toBe(revision+1);
  const states=new Map([['100',{visible:true,opacity:.5,intensity:1}]]);
  visual.setMeshSpeech(states,4);
  expect(visual.meshVisibilityRevision).toBe(revision+2);
  visual.setMeshSpeech(new Map([['100',{visible:true,opacity:1,intensity:.3}]]),4);
  expect(visual.meshVisibilityRevision).toBe(revision+2);
  expect(visual.renderGeneration).toBe(generation);
 }finally{visual.dispose();}
});

test('camera blocker edits do not rebuild visual resources',async()=>{
 const a=asset();let loads=0;
 const visual=new StudioVisual(client,renderer,async()=>{loads++;return a.group;});
 try{
  const first=scene('one');await visual.update(first);
  const updated:StudioScene={...first,revision:1,camera:{blockers:[{id:'wall',min:[-1,0,0],max:[1,2,1]}]}};
  await visual.update(updated);
  expect(loads).toBe(1);expect(a.disposed()).toBe(0);
  expect(visual.definition).toBe(updated);expect(visual.matchesRequested).toBe(true);
 }finally{visual.dispose();}
});

test('same bundle is decoded once across placements and transform-only changes',async()=>{
 const a=asset();let calls=0;
 const visual=new StudioVisual(client,renderer,async()=>{calls++;return a.group;});
 const first=scene('one'),object=first.objects[0]!;
 if(object.kind!=='model')throw Error('fixture');
 first.objects.push({...object,id:'two'});
 await visual.update(first);
 expect(calls).toBe(1);expect(visual.diagnostics().models[0]?.references).toBe(2);
 const [left,right]=visual.root.children[0]!.children;
 const l=left!.children[0] as THREE.Mesh,r=right!.children[0] as THREE.Mesh;
 expect(l.geometry).toBe(r.geometry);expect(l.material).not.toBe(r.material);
 await visual.update({...first,revision:1,objects:[{...object,transform:{...object.transform,position:[2,0,0]}}]});
 expect(calls).toBe(1);expect(a.disposed()).toBe(0);expect(visual.diagnostics().models[0]?.references).toBe(1);
 visual.dispose();expect(a.disposed()).toBe(1);
});

test('a failed scene can retry the same definition without editing its settings',async()=>{
 const a=asset();let loads=0;
 const visual=new StudioVisual(client,renderer,async()=>{if(++loads===1)throw Error('TEMPORARY_LOAD_FAILURE');return a.group;});
 const definition=scene('retry');
 try{
  await visual.update(definition);expect(visual.error).toBe('TEMPORARY_LOAD_FAILURE');expect(visual.matchesRequested).toBe(false);
  await visual.update(definition);
  expect(loads).toBe(2);expect(visual.error).toBe('');expect(visual.readyForCamera).toBe(true);expect(visual.matchesRequested).toBe(true);
 }finally{visual.dispose();}
 expect(a.disposed()).toBe(1);
});

test('equivalent updates wait for the same unfinished scene load',async()=>{
 const a=asset();let resolve!:(value:THREE.Group)=>void,loads=0,joined=false;
 const visual=new StudioVisual(client,renderer,async()=>{loads++;return new Promise(done=>{resolve=done;});});
 try{
  const first=visual.update(scene('same'));
  const updated:StudioScene={...scene('same'),revision:7,camera:{blockers:[{id:'wall',min:[-1,0,0],max:[1,2,1]}]}};
  const second=visual.update(updated).then(()=>{joined=true;});
  await Promise.resolve();
  const joinedEarly=joined;
  resolve(a.group);await Promise.all([first,second]);
  expect(joinedEarly).toBe(false);expect(joined).toBe(true);expect(loads).toBe(1);
  expect(visual.readyForCamera).toBe(true);expect(visual.renderGeneration).toBe(1);
  expect(visual.definition).toBe(updated);expect(visual.matchesRequested).toBe(true);
 }finally{visual.dispose();}
});

test('returning to the committed scene cancels a replacement without rebuilding the active scene',async()=>{
 const a=asset(),b=asset();let resolve!:(value:THREE.Group)=>void;
 const visual=new StudioVisual(client,renderer,async(_c,_r,id)=>id==='first'?a.group:new Promise(done=>{resolve=done;}));
 try{
  const first=scene('first');await visual.update(first);
  const generation=visual.renderGeneration,active=visual.root.children[0];
  const pending=visual.update(scene('next'));await Promise.resolve();
  await visual.update(first);
  expect(visual.loading).toBe(false);expect(visual.error).toBe('');
  expect(visual.matchesRequested).toBe(true);expect(visual.definition).toBe(first);
  expect(visual.renderGeneration).toBe(generation);expect(visual.root.children[0]).toBe(active);
  resolve(b.group);await pending;await Bun.sleep(0);
  expect(b.disposed()).toBe(1);expect(a.disposed()).toBe(0);
 }finally{visual.dispose();}
});

test('transient scene failures retry with a bounded budget while preserving the committed generation',async()=>{
 const a=asset(),b=asset();let now=0,loads=0;
 const visual=new StudioVisual(client,renderer,async(_c,_r,id)=>{
  if(id==='active')return a.group;
  loads++;if(id==='broken')throw Error('unavailable');return b.group;
 },()=>now);
 try{
  await visual.update(scene('active'));const active=visual.root.children[0];
  await visual.update(scene('broken'));expect(loads).toBe(1);
  for(let i=0;i<100;i++)visual.retry();await Bun.sleep(0);expect(loads).toBe(1);
  now=500;visual.retry();await Bun.sleep(0);expect(loads).toBe(2);
  now=2499;visual.retry();await Bun.sleep(0);expect(loads).toBe(2);
  now=2500;visual.retry();await Bun.sleep(0);expect(loads).toBe(3);
  now=1e9;for(let i=0;i<100;i++)visual.retry();await Bun.sleep(0);expect(loads).toBe(3);
  expect(visual.root.children[0]).toBe(active);expect(a.disposed()).toBe(0);expect(visual.setLength(1)).toBe('STUDIO_LOAD_FAILED');
  await visual.update(scene('repaired'));expect(loads).toBe(4);expect(visual.error).toBe('');expect(a.disposed()).toBe(1);
 }finally{visual.dispose();}
 expect(b.disposed()).toBe(1);
});
