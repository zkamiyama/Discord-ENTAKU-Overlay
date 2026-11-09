import * as THREE from 'three';
export type EffectTarget = 'world' | 'work' | 'ao' | 'reflections' | 'gi' | 'mapped' | 'antialiased';

/** Own only targets that are used. Three.js still allocates, resizes and disposes
 * the GPU objects; this class just makes application ownership explicit. */
export class EffectTargets {
  private targets = new Map<EffectTarget, THREE.WebGLRenderTarget>();
  private width = 1;
  private height = 1;

  has(name: EffectTarget): boolean {return this.targets.has(name);}
  get(name: EffectTarget): THREE.WebGLRenderTarget {
    const existing = this.targets.get(name);
    if (existing) return existing;
    const display = name === 'mapped' || name === 'antialiased';
    const target = new THREE.WebGLRenderTarget(this.width,this.height,{
      type:display ? THREE.UnsignedByteType : THREE.HalfFloatType,
      colorSpace:display ? THREE.NoColorSpace : THREE.LinearSRGBColorSpace,
      depthBuffer:name === 'world', generateMipmaps:false,
    });
    if (name === 'world') target.depthTexture = new THREE.DepthTexture(this.width,this.height,THREE.UnsignedIntType);
    this.targets.set(name,target);
    return target;
  }
  setSize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    for (const target of this.targets.values()) target.setSize(width,height);
  }
  release(name: EffectTarget): void {
    const target = this.targets.get(name);
    if (!target) return;
    this.targets.delete(name);
    target.dispose();
  }
  dispose(): void {for (const name of [...this.targets.keys()]) this.release(name);}
}
