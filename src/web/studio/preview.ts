import {DEFAULT_POST,resolvePostFocus,type PostSettings} from '../../studio/post-effects.ts';
import {DEFAULT_QUALITY,type QualitySettings} from '../../studio/quality.ts';
import {ExposureRenderer,createFallbackLights} from './exposure-renderer.ts';
import {DEFAULT_EXPOSURE,type ExposureSettings} from '../../studio/exposure.ts';
import {BroadcastDesk} from './broadcast-desk.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeObject } from './loader.ts';
export function makePreviewTable(length=3):BroadcastDesk{return new BroadcastDesk(length);}
/** Only an open editor owns this renderer. Closing it releases its WebGL context. */
export class PreviewStage {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(45,1,.05,500);
  readonly controls:OrbitControls;
  readonly table=makePreviewTable();
  postSettings:PostSettings={...DEFAULT_POST};
  qualitySettings:QualitySettings={...DEFAULT_QUALITY};
  exposureSettings:ExposureSettings={...DEFAULT_EXPOSURE};authoredLights=0;exposureSource='preview';
  private exposureRenderer:ExposureRenderer;
  private frame=0;private stopped=false;private previous=0;
  onFrame:()=>void=()=>{};
  constructor(readonly canvas:HTMLCanvasElement){
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setClearColor(0x111925);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.AgXToneMapping;
    const lights=createFallbackLights();this.scene.add(lights);this.exposureRenderer=new ExposureRenderer(this.renderer,lights);
    this.scene.add(new THREE.GridHelper(20,20,0x567086,0x293648),this.table);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.target.set(0,1,0);
    this.camera.position.set(5,4,6);this.controls.update();this.render(0);
  }
  fit(object:THREE.Object3D):void{
    object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object);if(box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const distance=Math.max(2,size.length()/(2*Math.sin(THREE.MathUtils.degToRad(this.camera.fov/2))));
    this.camera.position.copy(center).add(new THREE.Vector3(.7,.5,.9).normalize().multiplyScalar(distance));
    this.controls.target.copy(center);this.controls.update();
  }
  private render=(time:number):void=>{
    if(this.stopped)return;this.frame=requestAnimationFrame(this.render);
    if(document.hidden||time-this.previous<30)return;this.previous=time;
    const width=Math.max(1,this.canvas.clientWidth),height=Math.max(1,this.canvas.clientHeight);
    if(this.renderer.domElement.width!==Math.round(width*this.renderer.getPixelRatio())||this.renderer.domElement.height!==Math.round(height*this.renderer.getPixelRatio())){
      this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    }
    this.controls.update();this.onFrame();this.exposureRenderer.render(this.scene,this.camera,this.exposureSettings,this.exposureSource,this.authoredLights,time,this.qualitySettings,this.postSettings,resolvePostFocus(this.postSettings,{position:this.camera.position.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov},[]));
    this.canvas.dataset.exposure=String(this.exposureRenderer.report.exposure);this.canvas.dataset.exposureStatus=this.exposureRenderer.report.exposureStatus;
  };
  dispose():void{this.stopped=true;cancelAnimationFrame(this.frame);this.controls.dispose();this.exposureRenderer.dispose();disposeObject(this.scene);this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.replaceWith(this.canvas.cloneNode(false));}
}
