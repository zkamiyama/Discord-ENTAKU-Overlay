import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {AvatarPreview,type PreviewDependencies} from '../../src/web/dock/avatar-preview.ts';
import type {AvatarProfile} from '../../src/assets/avatar-profile.ts';
import type {PreviewStage} from '../../src/web/studio/preview.ts';
import type {CustomAvatarVisual} from '../../src/web/overlay/custom-avatar.ts';
import {DEFAULT_QUALITY} from '../../src/studio/quality.ts';
import {DEFAULT_POST} from '../../src/studio/post-effects.ts';
const profile={userId:'1',assetId:'0'.repeat(64),image:{width:64,height:128,mime:'image/png'},faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0} as AvatarProfile;
function fixture(){
 let disposed=0,copiesClosed=0;const jobs:Array<(v:CustomAvatarVisual)=>void>=[];
 const scene=new THREE.Scene(),stage={scene,camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},qualitySettings:{...DEFAULT_QUALITY},postSettings:{...DEFAULT_POST},dispose(){disposed++;}} as unknown as PreviewStage;
 const deps:PreviewDependencies={stage:()=>stage,delayMs:0,copy:async()=>({close(){copiesClosed++;}} as ImageBitmap),build:async()=>new Promise(resolve=>jobs.push(resolve))};
 const changes:unknown[]=[];const preview=new AvatarPreview({} as HTMLCanvasElement,e=>changes.push(e),()=>4,deps);
 const asset=()=>{let removed=0;const root=new THREE.Group();return {value:{root,update(){},dispose(){removed++;root.removeFromParent();}} as unknown as CustomAvatarVisual,releases:()=>removed};};
 return {preview,jobs,scene,stage,asset,changes,disposed:()=>disposed,copiesClosed:()=>copiesClosed};
}
const settle=()=>new Promise<void>(r=>setTimeout(r,5));
test('calibration uses a separate light renderer without changing program defaults',()=>{
 const f=fixture();expect(f.stage.qualitySettings).toMatchObject({ao:'off',reflections:false,gi:'off'});expect(DEFAULT_QUALITY.reflections).toBe(true);expect(f.stage.postSettings.enabled).toBe(false);f.preview.dispose();f.preview.dispose();expect(f.disposed()).toBe(1);
});
test('only the latest completed draft publishes and every owned bitmap copy closes',async()=>{
 const f=fixture(),image={} as ImageBitmap,back={} as ImageBitmap;
 f.preview.update(image,profile,back);await settle();expect(f.jobs).toHaveLength(1);
 f.preview.update(image,{...profile,scale:2},back);await settle();expect(f.jobs).toHaveLength(2);
 const old=f.asset(),current=f.asset();f.jobs[1]!(current.value);await settle();f.jobs[0]!(old.value);await settle();
 expect(f.scene.children).toEqual([current.value.root]);expect(old.releases()).toBe(1);expect(f.copiesClosed()).toBe(4);expect(f.preview.pending).toBe(false);
 f.preview.update(image,{...profile,scale:2},back);await settle();expect(f.jobs).toHaveLength(2);
 f.preview.dispose();expect(current.releases()).toBe(1);
});
test('closing while worker builds discards late results and cannot notify a closed editor',async()=>{
 const f=fixture();f.preview.update({} as ImageBitmap,profile);await settle();const late=f.asset();f.preview.dispose();const before=f.changes.length;
 f.jobs[0]!(late.value);await settle();expect(late.releases()).toBe(1);expect(f.copiesClosed()).toBe(1);expect(f.changes).toHaveLength(before);expect(f.scene.children).toEqual([]);
});
