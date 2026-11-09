import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {EffectTargets} from '../../src/web/studio/effect-targets.ts';
import {RenderRecovery} from '../../src/web/studio/render-recovery.ts';
import {createFocusMaterial,replaceShaderOnce} from '../../src/web/studio/addon-adapters.ts';

test('targets allocate lazily, resize once and are released exactly once',()=>{
  const pool=new EffectTargets();pool.setSize(640,360);expect(pool.has('world')).toBe(false);
  const world=pool.get('world');expect(pool.get('world')).toBe(world);expect(world.width).toBe(640);expect(world.depthTexture?.type).toBe(THREE.UnsignedIntType);
  let releases=0;world.addEventListener('dispose',()=>releases++);
  pool.setSize(640,360);expect(releases).toBe(0);pool.release('world');pool.release('world');expect(releases).toBe(1);
  const recreated=pool.get('world');expect(recreated).not.toBe(world);expect(recreated.height).toBe(360);
  expect(pool.get('mapped').texture.type).toBe(THREE.UnsignedByteType);expect(pool.get('ao').texture.type).toBe(THREE.HalfFloatType);
  pool.dispose();pool.dispose();expect(releases).toBe(1);expect(pool.has('world')).toBe(false);
});
test('render recovery retries at bounded deadlines and renews only for a new configuration',()=>{
  let now=0;const r=new RenderRecovery(()=>now);expect(r.canAttempt('a')).toBe(true);
  r.failed();now=499;expect(r.canAttempt('a')).toBe(false);now=500;expect(r.canAttempt('a')).toBe(true);
  r.failed();now=2499;expect(r.canAttempt('a')).toBe(false);now=2500;expect(r.canAttempt('a')).toBe(true);
  r.failed();now=100000;expect(r.canAttempt('a')).toBe(false);expect(r.canAttempt('b')).toBe(true);
  r.failed();r.succeeded();expect(r.canAttempt('b')).toBe(true);r.failed();r.reset();expect(r.canAttempt('b')).toBe(true);
});
test('addon shader changes fail explicitly instead of silently skipping compatibility fixes',()=>{
  expect(replaceShaderOnce('before TOKEN after','TOKEN','replacement','CHANGED')).toBe('before replacement after');
  for(const source of ['missing','TOKEN TOKEN'])expect(()=>replaceShaderOnce(source,'TOKEN','replacement','CHANGED')).toThrow('CHANGED');
  const material=createFocusMaterial();expect(material.fragmentShader).toContain('sharpRange');expect(material.fragmentShader).not.toContain('gl_FragColor.a = 1.0;');expect(material.depthWrite).toBe(false);material.dispose();
});
