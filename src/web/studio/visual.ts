import {BroadcastSet} from './broadcast-set.ts';
import * as THREE from 'three';
import type { StudioScene } from '../../studio/manifest.ts';
import type { StudioClient } from '../shared/client.ts';
import { loadStudioBundle,disposeObject } from './loader.ts';
export class StudioVisual {
  readonly root=new THREE.Group();
  private generation=0;
  private signature='';
  private loaded:THREE.Group|null=null;private broadcast:BroadcastSet|null=null;
  private definition:StudioScene|null=null;
  loading=false;error='';authoredLights=0;
  get renderGeneration():number{return this.generation;}
  constructor(private client:StudioClient,private renderer:THREE.WebGLRenderer){}
  async update(definition:StudioScene):Promise<void>{
    const signature=JSON.stringify({...definition,revision:0,exposure:undefined,quality:undefined,post:undefined,direction:undefined});if(signature===this.signature){this.definition=definition;return;}
    this.signature=signature;this.definition=definition;
    const version=++this.generation,stage=new THREE.Group();let broadcast:BroadcastSet|null=null;this.loading=true;this.error='';
    try{
      if(definition.broadcast?.enabled){broadcast=new BroadcastSet(definition.broadcast.title,definition.broadcast.subtitle);broadcast.position.fromArray(definition.tableAnchor.position);broadcast.rotation.y=definition.tableAnchor.yawDeg*Math.PI/180;stage.add(broadcast);}
      for(const item of definition.objects){
        let object:THREE.Object3D;
        if(item.kind==='model')object=await loadStudioBundle(this.client,this.renderer,item.bundleId);
        else if(item.kind==='box')object=new THREE.Mesh(new THREE.BoxGeometry(...item.size),new THREE.MeshStandardMaterial({color:item.color,roughness:.75}));
        else if(item.kind==='plane'){
          const plane=new THREE.Mesh(new THREE.PlaneGeometry(...item.size),new THREE.MeshStandardMaterial({color:item.color,side:THREE.DoubleSide,roughness:.9}));plane.rotation.x=-Math.PI/2;object=new THREE.Group();object.add(plane);
        }else object=new THREE.PointLight(item.color,item.intensity);
        if('transform' in item){object.position.fromArray(item.transform.position);object.rotation.y=THREE.MathUtils.degToRad(item.transform.yawDeg);object.scale.fromArray(item.transform.scale);}
        else object.position.fromArray(item.position);
        object.name=item.id;stage.add(object);
        if(version!==this.generation){disposeObject(stage);return;}
      }
      this.authoredLights=0;stage.traverseVisible(o=>{if(o instanceof THREE.Light&&o.intensity>0)this.authoredLights++;});
      if(this.loaded)disposeObject(this.loaded);this.loaded=stage;this.broadcast=broadcast;this.root.add(stage);
      this.root.updateMatrixWorld(true);
    }catch(e){disposeObject(stage);if(version===this.generation){this.authoredLights=0;this.error=e instanceof Error?e.message:'STUDIO_LOAD_FAILED';if(this.loaded){disposeObject(this.loaded);this.loaded=null;}}}
    finally{if(version===this.generation)this.loading=false;}
  }
  setLength(length:number,offsetZ=0):string{
    this.broadcast?.setLength(length,offsetZ);
    const overflow=!!this.definition&&length>this.definition.tableEnvelope.maxStraightLength;
    this.root.visible=!this.loading&&!this.error&&!(overflow&&this.definition?.tableEnvelope.overflow==='hide-studio');
    return this.error?'STUDIO_LOAD_FAILED':this.loading?'STUDIO_LOADING':overflow?'STUDIO_CAPACITY_OVERFLOW':'READY';
  }
  dispose():void{this.generation++;if(this.loaded)disposeObject(this.loaded);this.loaded=null;this.root.removeFromParent();}
}
