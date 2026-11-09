import * as THREE from 'three';
import type {AppSnapshot,CameraPose} from '../../contracts/domain.ts';
import {DEFAULT_POST,resolvePostFocus} from '../../studio/post-effects.ts';
import {DEFAULT_QUALITY} from '../../studio/quality.ts';
import {DEFAULT_EXPOSURE} from '../../studio/exposure.ts';
import {ExposureRenderer,createFallbackLights} from '../studio/exposure-renderer.ts';
import {SplitRenderer} from '../studio/split-renderer.ts';
import {visibleCasterKey} from '../studio/scene-effects-index.ts';
import {disposeObject} from '../studio/dispose.ts';
import type {StudioVisual} from '../studio/visual.ts';
import type {Avatar} from './avatar.ts';
/** Own single/split GPU pipelines and their lifetime. Exposure is shared across
 * panels; world shadow revisions never reset the metering history. */
export class ProgramRenderer {
 private exposureRenderer:ExposureRenderer;
 private splitRenderer:SplitRenderer;
 private fallbackLights=createFallbackLights();
 private wasSplit=false;
 private disposed=false;
 constructor(private renderer:THREE.WebGLRenderer,private scene:THREE.Scene,private stage:THREE.Group,private camera:THREE.PerspectiveCamera,private avatars:Map<string,Avatar>){
  scene.add(this.fallbackLights);this.exposureRenderer=new ExposureRenderer(renderer,this.fallbackLights);this.splitRenderer=new SplitRenderer(renderer);
 }
 get report(){return this.exposureRenderer.report;}
 render(state:AppSnapshot|null,pose:CameraPose,visual:StudioVisual,connected:boolean,time:number,length:number,offsetZ:number,near:number):Record<string,string>{
  if(this.disposed)return {};
  const {scene,stage,camera,avatars,exposureRenderer,splitRenderer}=this,debug:Record<string,string>={};
    const post=state?.studio.post??DEFAULT_POST;
    const selected=state?.camera.shot.userIds.length?state.camera.shot.userIds:state?.participants.filter(p=>p.presence==='present').map(p=>p.userId)??[];
    const subjects=selected.flatMap(id=>{const a=avatars.get(id);return a&&a.user.presence==='present'?[a.root.position.toArray() as [number,number,number]]:[];});
    const focus=resolvePostFocus(post,pose,subjects);
    debug.focusDistance=String(focus.distance);debug.focusRange=String(focus.range);debug.excludeAvatars=String(post.excludeAvatars);
    const panels=state?.camera.shot.kind==='SPLIT'&&connected&&visual.readyForCamera?state.camera.panels:undefined;
    const split=!!panels&&splitRenderer.supported;
    if(split!==this.wasSplit){if(split)exposureRenderer.releaseQuality();else splitRenderer.dispose();this.wasSplit=split;}
    const exposure=state?.studio.exposure??DEFAULT_EXPOSURE,quality=state?.studio.quality??DEFAULT_QUALITY;
    const meterSource=String(visual.renderGeneration);
    const source=[visual.renderGeneration,length,offsetZ,visual.root.visible,state?.session.revision??0,state?.studio.tableAnchor.position.join(',')??'',state?.studio.tableAnchor.yawDeg??0,visibleCasterKey([...avatars.values()].map(a=>a.plate))].join('|'),lights=visual.root.visible?visual.authoredLights:0;
    let report;
    if(split&&panels){
      const measured=exposureRenderer.prepare(scene,camera,exposure,meterSource,lights,time);
      const splitReport=splitRenderer.render(scene,panels,quality,post,source+'|'+measured.fallbackLights,(panel,panelCamera)=>{
        const local=new THREE.Vector3().fromArray(panel.pose.position);
        for(const avatar of avatars.values())avatar.faceCamera(local);
        panelCamera.position.copy(stage.localToWorld(local.clone()));panelCamera.lookAt(stage.localToWorld(new THREE.Vector3().fromArray(panel.pose.target)));
        panelCamera.fov=panel.pose.fov;panelCamera.near=near;panelCamera.far=1000;
        const subject=avatars.get(panel.userId);return resolvePostFocus(post,panel.pose,subject?[subject.root.position.toArray() as [number,number,number]]:[]);
      });
      report={...measured,...splitReport};exposureRenderer.report=report;
    }else report=exposureRenderer.render(scene,camera,exposure,meterSource,lights,time,quality,post,focus,source);
    debug.splitCount=split?'2':'1';debug.splitStatus=panels&&!split?'UNAVAILABLE':split?'ACTIVE':'OFF';
    debug.splitUsers=split?panels!.map(panel=>panel.userId).join(','):'';
    debug.exposure=String(report.exposure);debug.msaaSamples=String(report.msaaSamples??0);debug.renderScale=String(this.renderer.getPixelRatio());debug.qualityStatus=report.qualityStatus??'DIRECT';debug.shadowLights=String(report.shadowLights);debug.exposureStatus=report.exposureStatus;
    debug.authoredLights=String(report.authoredLights);debug.fallbackLights=String(report.fallbackLights);
  return debug;
 }
 dispose():void {
  if(this.disposed)return;this.disposed=true;
  this.exposureRenderer.dispose();this.splitRenderer.dispose();disposeObject(this.fallbackLights);
 }
}
