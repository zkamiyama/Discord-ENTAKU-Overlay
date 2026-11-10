import {expect,test,type Page} from './fixtures.ts';
import {personAction} from './controls.ts';
import {gaussianFixture} from '../tests/helpers/gaussian.ts';
import {png} from '../tests/helpers/png.ts';
import {mkdirSync,writeFileSync} from 'node:fs';
import {PerspectiveCamera,Vector3} from 'three';
import {DEFAULT_DIRECTION} from '../src/studio/direction.ts';
import type {AppSnapshot} from '../src/contracts/domain.ts';
import type {StoredGaussianAsset} from '../src/assets/gaussian-store.ts';

async function snapshot(page:Page):Promise<AppSnapshot>{
  return page.evaluate(()=>new Promise<any>((resolve,reject)=>{
    const ws=new WebSocket('ws://'+location.host+'/ws');const timer=setTimeout(()=>{ws.close();reject(new Error('SNAPSHOT_TIMEOUT'));},10000);
    ws.onmessage=event=>{const m=JSON.parse(String(event.data));if(m.type==='snapshot'){clearTimeout(timer);ws.close();resolve(m.state);}};
  }));
}
async function command(page:Page,value:Record<string,unknown>):Promise<void>{
  const state=await snapshot(page);
  const result=await page.evaluate(async({value,revision})=>{
    const r=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,expectedRevision:revision,requestId:crypto.randomUUID()})});
    return {status:r.status,body:await r.text()};
  },{value,revision:state.revision});expect(result.status,result.body).toBe(200);
}
async function importFixture(page:Page,index:number):Promise<StoredGaussianAsset>{
  const bytes=Array.from(gaussianFixture(index).archive);
  return page.evaluate(async bytes=>{
    const form=new FormData();form.set('archive',new File([new Uint8Array(bytes)],'character.entaku.zip',{type:'application/zip'}));
    const r=await fetch('/api/gaussian-assets/import',{method:'POST',body:form});if(!r.ok)throw new Error(await r.text());return r.json();
  },bytes);
}
const profile=(asset:StoredGaussianAsset,userId:string)=>({kind:'gaussian',userId,assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0});
const ready=async(page:Page,count:number)=>{
  await expect(page.locator('#scene')).toHaveAttribute('data-gaussian-instances',String(count),{timeout:90000});
  await expect.poll(async()=>page.locator('#scene').getAttribute('data-gaussian-status').then(s=>JSON.parse(s??'[]').every((r:any)=>r.phase==='ready')),{timeout:90000}).toBe(true);
  if(count)await expect.poll(async()=>Number(await page.locator('#scene').getAttribute('data-gaussian-selected-splats')),{timeout:90000}).toBeGreaterThan(0);
};
type FaceRegion={userId:string;color:number;left:number;right:number;top:number;bottom:number};
type DeskSample={userId:string;color:number;x:number;y:number};
const palette=[...Array.from({length:8},(_,i)=>gaussianFixture(i).color.map(c=>Math.round(c*255))),[230,160,100]];
/** Expected pixels come from published snapshot geometry and original fixture
 * centers, independently of the browser's scene graph or Gaussian runtime. */
function expectedPixels(state:AppSnapshot,ids:string[],colors=ids.map((_,i)=>i)){
 const pose=state.camera.to,camera=new PerspectiveCamera(pose.fov,16/9,state.studio.direction?.nearClip??DEFAULT_DIRECTION.nearClip,1000);
 camera.position.fromArray(pose.position);camera.lookAt(...pose.target);camera.updateMatrixWorld(true);
 const up=new Vector3(0,1,0),faces:FaceRegion[]=[],desk:DeskSample[]=[];
 for(let i=0;i<ids.length;i++){
  const userId=ids[i]!,color=colors[i]!,profile=state.avatarProfiles.find(p=>p.userId===userId)!,reservation=state.session.reservations.find(r=>r.userId===userId)!,seat=state.seats[reservation.slotIndex]!;
  const anchor=new Vector3(...seat.faceAnchor).add(new Vector3(profile.offsetX,profile.offsetY,profile.kind==='gaussian'?profile.offsetZ:0).applyAxisAngle(up,seat.baseYawRad));
  const points:Vector3[]=[];
  if(profile.kind==='gaussian'){
   const manifest=profile.manifest,world=(point:Vector3)=>point.sub(new Vector3(...manifest.faceAnchor)).multiplyScalar(profile.scale).applyAxisAngle(up,seat.baseYawRad+profile.yawRad).add(anchor);
   for(const x of [manifest.faceBounds.min[0],manifest.faceBounds.max[0]])for(const y of [manifest.faceBounds.min[1],manifest.faceBounds.max[1]])for(const z of [manifest.faceBounds.min[2],manifest.faceBounds.max[2]])points.push(world(new Vector3(x,y,z)).project(camera));
   if(seat.zone==='left'||seat.zone==='right'){
    const fixture=gaussianFixture(color),ply=fixture.files.find(f=>f.path==='avatar.ply')!.bytes,header=Buffer.from(ply).indexOf('end_header\n')+11;
    const data=new DataView(ply.buffer,ply.byteOffset,ply.byteLength),stride=(ply.byteLength-header)/fixture.splatCount;
    for(let n=0;n<fixture.splatCount;n++){
     const at=header+n*stride,center=world(new Vector3(data.getFloat32(at,true),data.getFloat32(at+4,true),data.getFloat32(at+8,true)));
     if(center.y>=.55)continue;
     // BroadcastDesk's wood top is y=.762, radii .72..1.44. Keep a .16m
     // margin inside its ring so edge AA and splat fringes are not the test.
     const t=(camera.position.y-.762)/(camera.position.y-center.y);if(t<=0||t>=1)continue;
     const hit=camera.position.clone().lerp(center,t),z=hit.z-(state.deskOffsetZ??0),radius=Math.hypot(hit.x,Math.max(0,Math.abs(z)-state.straightLength/2));
     if(radius<=.88||radius>=1.28)continue;
     const projected=center.project(camera);if(Math.abs(projected.x)>=.98||Math.abs(projected.y)>=.98||Math.abs(projected.z)>=1)continue;
     desk.push({userId,color,x:(projected.x+1)/2,y:(1-projected.y)/2});
    }
   }
  }else{
   // The image fixture has a square, opaque face crop. A small 3D envelope
   // permits its existing camera-facing rotation without reading private state.
   const half=.14*profile.scale;
   for(const x of [-half,half])for(const y of [-half,half])for(const z of [-half,half])points.push(anchor.clone().add(new Vector3(x,y,z)).project(camera));
  }
  faces.push({userId,color,left:(Math.min(...points.map(p=>p.x))+1)/2,right:(Math.max(...points.map(p=>p.x))+1)/2,top:(1-Math.max(...points.map(p=>p.y)))/2,bottom:(1-Math.min(...points.map(p=>p.y)))/2});
 }
 return {faces,desk};
}
async function inspectPixels(page:Page,bytes:Buffer,geometry:ReturnType<typeof expectedPixels>){
 return page.evaluate(async({bytes,palette,geometry})=>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);bitmap.close();const {width,height}=canvas,data=context.getImageData(0,0,width,height).data;
  const labels=new Int8Array(width*height).fill(-1),colorCounts=palette.map(()=>0);let transparent=0,colored=0;
  for(let n=0;n<labels.length;n++){
   const at=n*4,r=data[at]!,g=data[at+1]!,b=data[at+2]!,a=data[at+3]!;if(a<8)transparent++;if(a<220)continue;
   if(Math.max(r,g,b)-Math.min(r,g,b)>90)colored++;
   let best=30*30,label=-1;
   for(let j=0;j<palette.length;j++){const c=palette[j]!,distance=(r-c[0]!)**2+(g-c[1]!)**2+(b-c[2]!)**2;if(distance<best){best=distance;label=j;}}
   if(label>=0){labels[n]=label;colorCounts[label]=colorCounts[label]!+1;}
  }
  const faces=geometry.faces.map(region=>{
   const left=Math.max(0,Math.floor(region.left*width)-3),right=Math.min(width-1,Math.ceil(region.right*width)+3),top=Math.max(0,Math.floor(region.top*height)-3),bottom=Math.min(height-1,Math.ceil(region.bottom*height)+3);
   const seen=new Uint8Array(labels.length),counts=palette.map(()=>0);let largest=0,spanX=0,spanY=0,centerX=0,centerY=0;
   for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    const at=y*width+x,label=labels[at]!;if(label>=0)counts[label]=counts[label]!+1;if(label!==region.color||seen[at])continue;
    const todo=[at];seen[at]=1;let count=0,minX=x,maxX=x,minY=y,maxY=y,sumX=0,sumY=0;
    while(todo.length){const index=todo.pop()!,px=index%width,py=Math.floor(index/width);count++;sumX+=px;sumY+=py;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=px+dx,ny=py+dy,next=ny*width+nx;if(nx<left||nx>right||ny<top||ny>bottom||seen[next]||labels[next]!==region.color)continue;seen[next]=1;todo.push(next);}
    }
    if(count>largest){largest=count;spanX=maxX-minX+1;spanY=maxY-minY+1;centerX=sumX/count;centerY=sumY/count;}
   }
   const minimum=Math.max(16,Math.ceil((region.right-region.left)*width*(region.bottom-region.top)*height*.08));
   // The padding permits edge rasterization, but the connected component must
   // still belong inside this participant's independently projected face box.
   const inside=centerX>=region.left*width&&centerX<=region.right*width&&centerY>=region.top*height&&centerY<=region.bottom*height;
   return {...region,pixelBounds:{left,right,top,bottom},colorCounts:counts,largest,minimum,spanX,spanY,centerX,centerY,visible:largest>=minimum&&spanX>=3&&spanY>=3&&inside};
  });
  const visited=new Set<string>(),byUser:Record<string,{tested:number;opaqueWorld:number;gaussianLeaks:number}>={};let tested=0,opaqueWorld=0,gaussianLeaks=0;
  for(const point of geometry.desk){const x=Math.floor(point.x*width),y=Math.floor(point.y*height),key=`${point.userId}:${x}:${y}`;if(visited.has(key))continue;visited.add(key);
   const index=y*width+x,a=data[index*4+3]!,label=labels[index]!,world=a>230&&label<0,leak=label===point.color;const own=byUser[point.userId]??={tested:0,opaqueWorld:0,gaussianLeaks:0};
   tested++;own.tested++;if(world){opaqueWorld++;own.opaqueWorld++;}if(leak){gaussianLeaks++;own.gaussianLeaks++;}
  }
  return {width,height,colored,transparent,colorCounts,faces,desk:{tested,opaqueWorld,gaussianLeaks,byUser}};
 },{bytes:Array.from(bytes),palette,geometry});
}
async function identify(page:Page,name:string,geometry:ReturnType<typeof expectedPixels>){
 let measured:Awaited<ReturnType<typeof inspectPixels>>|undefined;
 await expect.poll(async()=>{
  const bytes=await page.locator('#scene').screenshot({path:`.work/gaussian/${name}.png`,omitBackground:true});measured=await inspectPixels(page,bytes,geometry);
  writeFileSync(`.work/gaussian/${name}.json`,JSON.stringify(measured,null,2));return measured.faces.map(face=>face.visible);
 },{timeout:30000,intervals:[250,500,1000]}).toEqual(geometry.faces.map(()=>true));
 return measured!;
}
test.beforeAll(()=>mkdirSync('.work/gaussian',{recursive:true}));

test('eight distinct packages render offline, share unchanged speech data and mix with existing 2D',async({page,context})=>{
  test.setTimeout(240000);await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  await command(page,{type:'demo-add'});await command(page,{type:'demo-add'});
  let state=await snapshot(page);const ids=state.participants.filter(p=>p.presence==='present').slice(0,8).map(p=>p.userId),assets:StoredGaussianAsset[]=[];
  const scene={...state.studio,quality:{...state.studio.quality,shadows:'off',ao:'off',reflections:false,msaa:0,fxaa:false,gi:'off'},post:{...state.studio.post,enabled:false}};
  await command(page,{type:'studio-set',scene});
  for(let i=0;i<8;i++){const asset=await importFixture(page,i);assets.push(asset);await command(page,{type:'avatar-set',profile:profile(asset,ids[i]!)});}
  expect(new Set(assets.map(a=>a.assetId)).size).toBe(8);expect(new Set(assets.map(a=>a.splatCount)).size).toBe(8);
  await command(page,{type:'wide'});await command(page,{type:'mode',mode:'HOLD'});
  const overlay=await context.newPage();await overlay.setViewportSize({width:640,height:360});
  const errors:string[]=[],external:string[]=[];overlay.on('pageerror',e=>errors.push(e.message));
  await overlay.route('**/*',route=>{const url=new URL(route.request().url());if(url.host!=='127.0.0.1:31339'){external.push(url.href);return route.abort();}return route.continue();});
  await overlay.goto('/overlay');await ready(overlay,8);
  state=await snapshot(page);const colors=await identify(overlay,'eight-characters',expectedPixels(state,ids));
  expect(colors.desk.tested).toBeGreaterThan(50);expect(Object.keys(colors.desk.byUser).length).toBeGreaterThanOrEqual(2);
  expect(colors.desk.opaqueWorld).toBeGreaterThan(colors.desk.tested*.9);expect(colors.desk.gaussianLeaks).toBeLessThan(colors.desk.tested*.05);
  // One participant changes to an already loaded green character, then back.
  // This ties the colored component to that participant, not studio decoration.
  await command(page,{type:'avatar-set',profile:profile(assets[1]!,ids[0]!)});await ready(overlay,8);
  const swapped=await identify(overlay,'eight-one-replaced',expectedPixels(await snapshot(page),ids,ids.map((_,i)=>i===0?1:i)));
  expect(swapped.faces[0]!.colorCounts[0]).toBeLessThan(Math.max(6,colors.faces[0]!.colorCounts[0]!*.1));
  await command(page,{type:'avatar-set',profile:profile(assets[0]!,ids[0]!)});await ready(overlay,8);
  const restored=await identify(overlay,'eight-restored',expectedPixels(await snapshot(page),ids));
  expect(restored.faces[0]!.largest).toBeGreaterThan(colors.faces[0]!.largest*.8);
  const before=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());
  await command(page,{type:'demo-speaking',userId:ids[0],active:true});await command(page,{type:'demo-speaking',userId:ids[0],active:false});
  const after=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());
  expect(after.assets.map((a:any)=>a.loadMs)).toEqual(before.assets.map((a:any)=>a.loadMs));
  expect(after.assets.map((a:any)=>a.decodeAndLodMs)).toEqual(before.assets.map((a:any)=>a.decodeAndLodMs));
  await command(page,{type:'demo-presence',userId:ids[0],present:false});await command(page,{type:'demo-presence',userId:ids[0],present:true});
  await command(page,{type:'seat-move',userId:ids[0],slotIndex:state.session.reservations.find(r=>r.userId===ids[1])!.slotIndex});
  const image=await page.request.post('/api/assets',{headers:{Origin:'http://127.0.0.1:31339','Content-Type':'image/png'},data:png()});expect(image.ok()).toBe(true);const imageAsset=await image.json();
  await command(page,{type:'avatar-set',profile:{userId:ids[0],assetId:imageAsset.assetId,image:{width:imageAsset.width,height:imageAsset.height,mime:imageAsset.mime},faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0}});
  await ready(overlay,7);const mixed=await identify(overlay,'mixed-2d-3dgs',expectedPixels(await snapshot(page),ids,ids.map((_,i)=>i===0?8:i)));
  expect(external).toEqual([]);expect(errors).toEqual([]);
  writeFileSync('.work/gaussian/eight-results.json',JSON.stringify({assets:assets.map(a=>({assetId:a.assetId,splats:a.splatCount,bytes:a.byteLength})),before,after,colors,swapped,restored,mixed},null,2));
});

test('Gaussian editor calibrates without image rectangles and exports portable placement',async({page})=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const person=page.locator('.person').first();await personAction(page,person,'アバターを調整');await page.locator('#avatar-kind').selectOption('gaussian');
  await expect(page.locator('#avatar-image-fields')).not.toBeVisible();
  await page.locator('#gaussian-file').setInputFiles({name:'synthetic.entaku.zip',mimeType:'application/zip',buffer:Buffer.from(gaussianFixture(2).archive)});
  await page.locator('#gaussian-import').click();await expect(page.locator('#gaussian-status')).toHaveAttribute('data-phase','ready',{timeout:90000});
  await page.locator('#gaussian-scale').fill('0.9');await page.locator('#gaussian-yaw').fill('25');await page.locator('#gaussian-offset-z').fill('0.1');
  await expect(page.locator('#avatar-apply')).toBeEnabled();
  const download=page.waitForEvent('download');await page.locator('#gaussian-export').click();const exported=await download;await exported.saveAs('.work/gaussian/editor-export.entaku.zip');
  await page.locator('#avatar-apply').click();await expect(page.locator('#avatar-editor')).not.toBeVisible();
  let state=await snapshot(page);const saved=state.avatarProfiles.find(p=>p.userId==='100')!;
  expect(saved.kind).toBe('gaussian');expect(saved.scale).toBe(.9);expect(saved).not.toHaveProperty('faceRect');
  await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await personAction(page,page.locator('.person').first(),'アバターを調整');
  await expect(page.locator('#gaussian-scale')).toHaveValue('0.9');await expect(page.locator('#gaussian-yaw')).toHaveValue('25');await expect(page.locator('#avatar-apply')).toBeEnabled({timeout:90000});
  await page.locator('#avatar-cancel').click();await personAction(page,page.locator('.person').nth(1),'アバターを調整');await page.locator('#avatar-kind').selectOption('gaussian');
  await page.locator('#gaussian-file').setInputFiles('.work/gaussian/editor-export.entaku.zip');await page.locator('#gaussian-import').click();await expect(page.locator('#avatar-apply')).toBeEnabled({timeout:90000});
  await expect(page.locator('#gaussian-scale')).toHaveValue('0.9');await expect(page.locator('#gaussian-yaw')).toHaveValue('25');await page.locator('#avatar-apply').click();
  state=await snapshot(page);const second=state.avatarProfiles.find(p=>p.userId==='101')!;expect(second.scale).toBe(saved.scale);expect(second.kind).toBe('gaussian');expect(errors).toEqual([]);
});

test('late A load and failed replacement cannot resurrect obsolete characters or stop another user',async({page,context})=>{
  test.setTimeout(180000);await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const a=await importFixture(page,0),b=await importFixture(page,1);
  await command(page,{type:'avatar-set',profile:profile(a,'100')});await command(page,{type:'avatar-set',profile:profile(b,'101')});
  const overlay=await context.newPage();await overlay.setViewportSize({width:480,height:270});
  let releaseA:()=>void=()=>{};const stalled=new Promise<void>(r=>{releaseA=r;});let arrived=false;
  await overlay.route(`**/api/gaussian-assets/${a.assetId}/file?*`,async route=>{arrived=true;await stalled;await route.continue().catch(()=>{});});
  await overlay.goto('/overlay');await expect.poll(()=>arrived).toBe(true);
  await command(page,{type:'avatar-set',profile:profile(b,'100')});releaseA();await ready(overlay,2);
  const shared=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());expect(shared.assets).toHaveLength(1);expect(shared.assets[0].references).toBe(2);
  await command(page,{type:'avatar-reset',userId:'100'});await ready(overlay,1);
  await overlay.route(`**/api/gaussian-assets/${a.assetId}/file?*`,route=>route.fulfill({status:500,body:'fixture failure'}));
  await command(page,{type:'avatar-set',profile:profile(a,'100')});
  await expect.poll(async()=>JSON.parse(await overlay.locator('#scene').getAttribute('data-gaussian-status')??'[]').some((s:any)=>s.userId==='100'&&s.phase==='error'),{timeout:90000}).toBe(true);
  expect(await overlay.locator('#scene').getAttribute('data-gaussian-instances')).toBe('1');
  const live=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());expect(live.assets.some((a:any)=>a.references===1&&a.inputSplats===b.splatCount)).toBe(true);
});
