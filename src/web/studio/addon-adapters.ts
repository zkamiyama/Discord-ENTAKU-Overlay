import * as THREE from 'three';
import {SSRPass} from 'three/addons/postprocessing/SSRPass.js';
import {BokehShader} from 'three/addons/shaders/BokehShader.js';
import type {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';

type ReflectionInternals=SSRPass&{
 _renderPass(renderer:THREE.WebGLRenderer,material:THREE.Material,target:THREE.WebGLRenderTarget):void;
 _renderOverride(renderer:THREE.WebGLRenderer,material:THREE.Material,target:THREE.WebGLRenderTarget,clearColor:number,clearAlpha:number):void;
 _renderMetalness(renderer:THREE.WebGLRenderer,material:THREE.Material,target:THREE.WebGLRenderTarget,clearColor:number,clearAlpha:number):void;
};

/** r187 has no external beauty/depth input: render() always redraws its scene.
 * Only its input orchestration is adapted. Ray traversal, receiver selection,
 * Fresnel, attenuation and both blur passes remain the official implementation. */
export function reflectionInternals(pass:SSRPass):ReflectionInternals {
 const candidate=pass as ReflectionInternals;
 if(THREE.REVISION!=='187'||['_renderPass','_renderOverride','_renderMetalness'].some(key=>typeof (candidate as unknown as Record<string,unknown>)[key]!=='function')||
  !pass.beautyRenderTarget.depthTexture||!pass.ssrMaterial.uniforms.tDiffuse||!pass.ssrMaterial.uniforms.tDepth||!pass.ssrMaterial.uniforms.tNormal||!pass.ssrMaterial.uniforms.tMetalness)
  throw new Error('THREE_SSR_INPUT_ADAPTER_CHANGED');
 return candidate;
}

/** The caller has populated beauty COLOR first, then world+proxy DEPTH, and
 * selected geometry-only layers on the camera. No splat enters an override. */
export function renderPreparedReflection(pass:SSRPass,renderer:THREE.WebGLRenderer,output:THREE.WebGLRenderTarget):void {
 const bridge=reflectionInternals(pass),override=pass.scene.overrideMaterial,background=pass.scene.background,fog=pass.scene.fog;
 const saved:Array<[THREE.Object3D&{material?:THREE.Material|THREE.Material[]},THREE.Material|THREE.Material[]|undefined]>=[];
 pass.scene.traverseVisible(object=>{const o=object as THREE.Object3D&{material?:THREE.Material|THREE.Material[]};saved.push([o,o.material]);});
 try{
  bridge._renderOverride(renderer,pass.normalMaterial,pass.normalRenderTarget,0,0);
  if(pass.selective)bridge._renderMetalness(renderer,pass.metalnessOnMaterial,pass.metalnessRenderTarget,0,0);
  const u=pass.ssrMaterial.uniforms;
  u.tDiffuse!.value=pass.beautyRenderTarget.texture;u.tDepth!.value=pass.beautyRenderTarget.depthTexture;
  u.tNormal!.value=pass.normalRenderTarget.texture;u.tMetalness!.value=pass.metalnessRenderTarget.texture;
  u.opacity!.value=pass.opacity;u.maxDistance!.value=pass.maxDistance;u.thickness!.value=pass.thickness;
  bridge._renderPass(renderer,pass.ssrMaterial,pass.ssrRenderTarget);
  if(pass.blur){bridge._renderPass(renderer,pass.blurMaterial,pass.blurRenderTarget);bridge._renderPass(renderer,pass.blurMaterial2,pass.blurRenderTarget2);}
  pass.copyMaterial.uniforms.tDiffuse!.value=pass.blur?pass.blurRenderTarget2.texture:pass.ssrRenderTarget.texture;
  pass.copyMaterial.blending=THREE.NoBlending;
  bridge._renderPass(renderer,pass.copyMaterial,output);
 }finally{
  for(const [object,material]of saved){if(material===undefined)delete object.material;else object.material=material;}
  pass.scene.overrideMaterial=override;pass.scene.background=background;pass.scene.fog=fog;
 }
}

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
