import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {SparkRenderer} from '@sparkjsdev/spark';
import {GaussianRuntime} from '../../src/web/gaussian/runtime.ts';

function setup(){
  // Exercise production diagnostics with the actual packaged SparkRenderer.
  // This fake WebGL owner does not draw, launch workers or claim a GPU result.
  let height=360;
  const renderer={getContext:()=>({getExtension:()=>null}),getRenderTarget:()=>null,
    getDrawingBufferSize:(value:THREE.Vector2)=>value.set(640,height),render:()=>{},
    info:{memory:{textures:0,geometries:0},programs:[]}} as unknown as THREE.WebGLRenderer;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,16/9,.05,100);
  camera.position.set(0,1.2,2);camera.lookAt(0,.8,0);camera.updateMatrixWorld(true);
  const runtime=new GaussianRuntime(renderer,scene),release=runtime.retainVisual();runtime.setBudget(1000);runtime.render(camera);
  const view=scene.children.find(object=>object instanceof SparkRenderer) as SparkRenderer;
  const completed={pos:camera.getWorldPosition(new THREE.Vector3()),quat:camera.getWorldQuaternion(new THREE.Quaternion()),
    pixelScaleLimit:2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height,maxSplats:1000,timestamp:10};
  view.currentLod=completed;view.lastLod=completed;
  return {runtime,camera,view,completed,resize:(value:number)=>{height=value;runtime.render(camera);},state:()=>runtime.diagnostics().views[0]!,dispose:()=>{release();runtime.dispose();}};
}

test('completed camera-matching LoD remains usable while the same shared selection is refreshed',()=>{
  const probe=setup();
  try{
    expect(probe.state().lodMatchesView).toBe(true);expect(probe.state().lodPending).toBe(false);
    probe.view.lodDirty=true;
    probe.view.lastLod={...probe.completed,pos:probe.completed.pos.clone(),quat:probe.completed.quat.clone(),timestamp:20};
    const state=probe.state();
    expect(state.lodPending).toBe(true);expect(state.lodMatchesView).toBe(true);
    expect(state.lodCompletedRequestAt).toBe(10);expect(state.lodRequestedAt).toBe(20);
    probe.view.currentLod=undefined;
    expect(probe.state().lodMatchesView).toBe(false);expect(probe.state().lodCompletedRequestAt).toBeNull();
  }finally{probe.dispose();}
});

test('old completed LoD is rejected after camera position, direction, projection or budget changes',()=>{
  const probe=setup();
  try{
    probe.camera.position.z+=1;probe.camera.updateMatrixWorld(true);expect(probe.state().lodMatchesView).toBe(false);
    probe.camera.position.copy(probe.completed.pos);probe.camera.updateMatrixWorld(true);expect(probe.state().lodMatchesView).toBe(true);
    probe.camera.rotateY(Math.PI);probe.camera.updateMatrixWorld(true);expect(probe.state().lodMatchesView).toBe(false);
    probe.camera.quaternion.copy(probe.completed.quat);probe.camera.updateMatrixWorld(true);expect(probe.state().lodMatchesView).toBe(true);
    probe.resize(720);expect(probe.state().lodMatchesView).toBe(false);
    probe.resize(360);expect(probe.state().lodMatchesView).toBe(true);
    probe.camera.fov=60;probe.camera.updateProjectionMatrix();expect(probe.state().lodMatchesView).toBe(false);
    probe.camera.fov=42;probe.camera.updateProjectionMatrix();expect(probe.state().lodMatchesView).toBe(true);
    probe.runtime.setBudget(2000);expect(probe.state().lodMatchesView).toBe(false);
  }finally{probe.dispose();}
});
