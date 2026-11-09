import * as THREE from 'three';
import {SSRPass} from 'three/addons/postprocessing/SSRPass.js';
import {BokehShader} from 'three/addons/shaders/BokehShader.js';
import type {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';

/** The pinned addons have no public switches for these alpha/depth fixes.
 * Fail explicitly when a future addon changes instead of silently skipping them. */
export function replaceShaderOnce(source: string, search: string, replacement: string, error: string): string {
  const first = source.indexOf(search);
  if (!search || first < 0 || source.indexOf(search, first + search.length) >= 0) throw new Error(error);
  return source.slice(0,first) + replacement + source.slice(first + search.length);
}

export function createReflectionPass(options: ConstructorParameters<typeof SSRPass>[0]): SSRPass {
  const pass = new SSRPass(options);
  try {
    pass.beautyRenderTarget.depthTexture!.type = THREE.UnsignedIntType;
    pass.output = SSRPass.OUTPUT.SSR;
    pass.ssrMaterial.fragmentShader = replaceShaderOnce(pass.ssrMaterial.fragmentShader,'void main(){','void main(){gl_FragColor=vec4(0.);','THREE_SSR_SHADER_CHANGED');
    for (const target of [pass.ssrRenderTarget,pass.blurRenderTarget,pass.blurRenderTarget2]) {
      target.texture.type = THREE.HalfFloatType;
      target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
    }
    return pass;
  } catch (error) {disposeReflectionPass(pass);throw error;}
}
export function disposeReflectionPass(pass: SSRPass): void {
  // r187 SSRPass.dispose does not own ssrMaterial; the adapter owns that cleanup.
  pass.ssrMaterial.dispose();
  pass.dispose();
}
export function createFocusMaterial(): THREE.ShaderMaterial {
  let source = replaceShaderOnce(BokehShader.fragmentShader,'float factor = ( focus + viewZ );','float delta = focus + viewZ; float factor = sign(delta) * max(0., abs(delta) - sharpRange);','THREE_BOKEH_SHADER_CHANGED');
  source = replaceShaderOnce(source,'gl_FragColor.a = 1.0;','','THREE_BOKEH_ALPHA_CHANGED');
  return new THREE.ShaderMaterial({
    defines:{...BokehShader.defines,DEPTH_PACKING:0},
    uniforms:{...THREE.UniformsUtils.clone(BokehShader.uniforms),sharpRange:{value:.5}},
    vertexShader:BokehShader.vertexShader,fragmentShader:'uniform float sharpRange;\n'+source,
    toneMapped:false,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
  });
}
export function bloomTexture(pass: UnrealBloomPass): THREE.Texture {
  const texture = pass.renderTargetsHorizontal[0]?.texture;
  if (!texture) throw new Error('THREE_BLOOM_TARGET_CHANGED');
  return texture;
}
