import {QualityRenderer,type QualityStatus} from './quality-renderer.ts';
import {DEFAULT_QUALITY,type QualitySettings} from '../../studio/quality.ts';
import * as THREE from 'three';
import {adaptExposure,clampExposure,DEFAULT_EXPOSURE,meterExposure,useFallbackLights,type ExposureSettings} from '../../studio/exposure.ts';
export const DISPLAY_LAYER=1;
/** Display RGB stays unlit and untone-mapped in direct or composited rendering.
 * The separate layer also keeps these objects out of exposure metering and screen effects. */
export function protectDisplayObject(root:THREE.Object3D):void {
  root.traverse(object=>{
    object.layers.set(DISPLAY_LAYER);
    if(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.Points){
      for(const material of Array.isArray(object.material)?object.material:[object.material])material.toneMapped=false;
    }
  });
}
export function createFallbackLights():THREE.Group {
  const group=new THREE.Group();group.name='ENTAKU fallback lights';
  group.add(new THREE.HemisphereLight(0xfff0da,0x6b6b65,1.7));
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,6,4);group.add(key);
  const rim=new THREE.DirectionalLight(0xffd5a1,1.2);rim.position.set(-3,3,-4);group.add(rim);return group;
}
export type ExposureStatus='AUTO'|'MANUAL'|'EMPTY_METER'|'HDR_UNAVAILABLE'|'METER_FAILED';
export interface ExposureReport {exposure:number;exposureStatus:ExposureStatus;authoredLights:number;fallbackLights:boolean;qualityStatus?:QualityStatus;shadowLights?:number}
/** Low-resolution HDR meter uses Three.js render targets/readback. QualityRenderer
 * uses either direct rendering or depth-preserving effects followed by the display layer. */
export class ExposureRenderer {
  private readonly quality:QualityRenderer;
  private readonly target:THREE.WebGLRenderTarget;
  private readonly buffer:Uint16Array;
  private readonly linear:Float32Array;
  private pending=false;private disposed=false;private generation=0;private source='';
  private nextMeter=0;private lastFrame=0;private initialized=false;private current=1;private desired=1;
  private status:ExposureStatus='AUTO';private available:boolean;
  private readonly width=64;private readonly height=36;
  report:ExposureReport={exposure:1,exposureStatus:'AUTO',authoredLights:0,fallbackLights:true};
  constructor(private readonly renderer:THREE.WebGLRenderer,private readonly fallback:THREE.Group){
    this.quality=new QualityRenderer(renderer,DISPLAY_LAYER);
    this.available=renderer.extensions.has('EXT_color_buffer_float')||renderer.extensions.has('EXT_color_buffer_half_float');
    this.target=new THREE.WebGLRenderTarget(this.width,this.height,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,colorSpace:THREE.LinearSRGBColorSpace,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,generateMipmaps:false});
    this.buffer=new Uint16Array(this.width*this.height*4);this.linear=new Float32Array(this.buffer.length);
  }
  private decode():number|null {
    for(let i=0;i<this.buffer.length;i++)this.linear[i]=THREE.DataUtils.fromHalfFloat(this.buffer[i]!);
    return meterExposure(this.linear);
  }
  private sample(scene:THREE.Scene,camera:THREE.Camera,sync:boolean):void {
    const renderer=this.renderer,oldTarget=renderer.getRenderTarget(),mask=camera.layers.mask;
    const color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),autoClear=renderer.autoClear;
    const background=scene.background,viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
    const token=this.generation;
    try{
      camera.layers.disable(DISPLAY_LAYER);scene.background=null;renderer.autoClear=true;
      renderer.setClearColor(0,0);renderer.setRenderTarget(this.target);renderer.setScissorTest(false);
      // Render targets bypass tone mapping. The HalfFloat texture is linear HDR, not a clipped screenshot.
      renderer.render(scene,camera);
      if(sync){
        renderer.readRenderTargetPixels(this.target,0,0,this.width,this.height,this.buffer);
        const value=this.decode();this.initialized=true;
        if(value!==null){this.current=this.desired=value;this.status='AUTO';}else this.status='EMPTY_METER';
      }else{
        this.pending=true;
        void renderer.readRenderTargetPixelsAsync(this.target,0,0,this.width,this.height,this.buffer).then(()=>{
          if(this.disposed||token!==this.generation)return;
          const value=this.decode();
          if(value!==null){this.desired=value;this.status='AUTO';}else this.status='EMPTY_METER';
        }).catch(()=>{if(!this.disposed&&token===this.generation){this.status='METER_FAILED';this.available=false;}})
          .finally(()=>{this.pending=false;if(this.disposed)this.target.dispose();});
      }
    }catch{this.status='METER_FAILED';this.available=false;this.initialized=true;}
    finally{
      camera.layers.mask=mask;scene.background=background;renderer.autoClear=autoClear;renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(color,alpha);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    }
  }
  render(scene:THREE.Scene,camera:THREE.Camera,settings:ExposureSettings=DEFAULT_EXPOSURE,source='',authoredLights=0,now=performance.now(),quality:QualitySettings=DEFAULT_QUALITY):ExposureReport {
    if(this.disposed)return this.report;
    const key=source+'|'+settings.mode+'|'+settings.lighting+'|'+authoredLights;
    if(key!==this.source){this.source=key;this.generation++;this.initialized=false;this.nextMeter=0;}
    this.fallback.visible=useFallbackLights(settings,authoredLights);
    this.renderer.toneMapping=THREE.AgXToneMapping;this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    camera.layers.enable(DISPLAY_LAYER);
    if(settings.mode==='auto'&&this.available&&!this.pending&&now>=this.nextMeter){
      this.sample(scene,camera,!this.initialized);this.nextMeter=now+250;
    }
    if(settings.mode==='auto'&&this.available){this.current=adaptExposure(this.current,this.desired,(now-this.lastFrame)/1000);}
    else if(settings.mode==='manual'){this.current=settings.manualExposure;this.status='MANUAL';}
    else {this.current=settings.manualExposure;if(this.status!=='METER_FAILED')this.status='HDR_UNAVAILABLE';}
    this.lastFrame=now;
    const exposure=clampExposure(this.current*2**settings.compensationEV);
    this.renderer.toneMappingExposure=exposure;
    this.quality.render(scene,camera,quality,source+'|'+this.fallback.visible);
    this.report={exposure,exposureStatus:this.status,authoredLights,fallbackLights:this.fallback.visible,qualityStatus:this.quality.status,shadowLights:this.quality.shadowLights};return this.report;
  }
  dispose():void{this.quality.dispose();this.disposed=true;this.generation++;if(!this.pending)this.target.dispose();}
}
