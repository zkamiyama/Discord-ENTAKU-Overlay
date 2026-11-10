import {PreviewStage} from '../studio/preview.ts';
import {GaussianRuntime} from '../gaussian/runtime.ts';
import {GaussianAvatarVisual,type GaussianLoadStatus} from '../gaussian/avatar-visual.ts';
import type {GaussianAvatarProfile} from '../../assets/gaussian-profile.ts';

/** The editor has one existing preview renderer, shared by all Gaussian data. */
export class GaussianPreview {
  private stage:PreviewStage;
  private runtime:GaussianRuntime;
  private visual:GaussianAvatarVisual;
  private closed=false;
  constructor(canvas:HTMLCanvasElement,changed:(status:GaussianLoadStatus)=>void){
    let stage:PreviewStage|undefined,runtime:GaussianRuntime|undefined,visual:GaussianAvatarVisual|undefined;
    try{
    this.stage=stage=new PreviewStage(canvas);
    this.stage.qualitySettings={...this.stage.qualitySettings,shadows:'off',ao:'off',reflections:false,gi:'off',fxaa:false,msaa:0};
    this.stage.postSettings={...this.stage.postSettings,enabled:false};
    this.runtime=runtime=new GaussianRuntime(this.stage.renderer,this.stage.scene);
    this.runtime.setBudget(250000);
    this.visual=visual=new GaussianAvatarVisual(this.runtime,changed);
    this.stage.scene.add(this.visual.root);
    this.stage.controls.target.set(0,1.25,3.4);
    this.stage.camera.position.set(0,1.65,1.4);this.stage.controls.update();
    this.stage.onFrame=()=>this.visual.update(1,.85+.15*Math.sin(performance.now()*.006));
    }catch(error){visual?.dispose();runtime?.dispose();stage?.dispose();throw error;}
  }
  update(profile:GaussianAvatarProfile):void {
    if(this.closed)return;
    this.visual.root.position.set(-profile.offsetX,1.25+profile.offsetY,3.4-profile.offsetZ);
    this.visual.root.rotation.y=Math.PI;
    void this.visual.setProfile(profile).catch(()=>{/* The visual reports an actionable status. */});
  }
  dispose():void {
    if(this.closed)return;this.closed=true;
    this.visual.dispose();this.runtime.dispose();this.stage.dispose();
  }
}
