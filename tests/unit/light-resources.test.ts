import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {disposeObject} from '../../src/web/studio/dispose.ts';

test('scene disposal releases standard light shadow maps and is idempotent',()=>{
 const root=new THREE.Group(),light=new THREE.DirectionalLight();root.add(light);
 const shadow=new THREE.WebGLRenderTarget(1,1);light.shadow.map=shadow;let releases=0;
 shadow.addEventListener('dispose',()=>releases++);
 disposeObject(root);expect(releases).toBe(1);expect(root.children).toHaveLength(0);
 disposeObject(root);expect(releases).toBe(1);
});
