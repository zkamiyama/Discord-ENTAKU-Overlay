import * as THREE from 'three';
/** Snapshot the mutable renderer state around a multi-pass operation. The caller
 * owns output textures; restoring a framebuffer never disposes their contents. */
export function saveRenderState(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera?:THREE.Camera):()=>void {
 const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
 const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
 const color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),auto=renderer.autoClear;
 const output=renderer.outputColorSpace,background=scene.background,mask=camera?.layers.mask,shadow=renderer.shadowMap.autoUpdate;
 return ()=>{
  renderer.autoClear=auto;renderer.outputColorSpace=output;renderer.shadowMap.autoUpdate=shadow;
  scene.background=background;if(camera&&mask!==undefined)camera.layers.mask=mask;
  renderer.setRenderTarget(target,face,mip);renderer.setClearColor(color,alpha);
  renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
 };
}
