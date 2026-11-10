import {expect,test,type Page} from './fixtures.ts';
import {personAction} from './controls.ts';
import {gaussianFixture} from '../tests/helpers/gaussian.ts';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {AppSnapshot} from '../src/contracts/domain.ts';
import type {StoredGaussianAsset} from '../src/assets/gaussian-store.ts';

async function snapshot(page:Page):Promise<AppSnapshot>{
 return page.evaluate(()=>new Promise<any>((resolve,reject)=>{
  const ws=new WebSocket('ws://'+location.host+'/ws'),timer=setTimeout(()=>{ws.close();reject(new Error('SNAPSHOT_TIMEOUT'));},10000);
  ws.onmessage=event=>{const m=JSON.parse(String(event.data));if(m.type==='snapshot'){clearTimeout(timer);ws.close();resolve(m.state);}};
 }));
}
async function command(page:Page,value:Record<string,unknown>){
 const state=await snapshot(page);
 const response=await page.evaluate(async({value,revision})=>{
  const r=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,expectedRevision:revision,requestId:crypto.randomUUID()})});
  return {status:r.status,body:await r.text()};
 },{value,revision:state.revision});expect(response.status,response.body).toBe(200);
}
async function importAsset(page:Page,index:number):Promise<StoredGaussianAsset>{
 return page.evaluate(async bytes=>{
  const form=new FormData();form.set('archive',new File([new Uint8Array(bytes)],'resource-fixture.entaku.zip',{type:'application/zip'}));
  const r=await fetch('/api/gaussian-assets/import',{method:'POST',body:form});if(!r.ok)throw new Error(await r.text());return r.json();
 },Array.from(gaussianFixture(index).archive));
}
const profile=(asset:StoredGaussianAsset,userId:string)=>({kind:'gaussian',userId,assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0});
const diagnostics=(page:Page)=>page.evaluate(()=>(window as any).entakuGaussianDiagnostics());
const resources=(page:Page)=>page.evaluate(()=>(window as any).entakuResourceProbe());
async function ready(page:Page,instances:number,splatCount?:number){
 await page.bringToFront();
 await expect.poll(async()=>{
  const d=await diagnostics(page);
  return d.instances===instances&&d.assets.length===(instances?1:0)&&d.assets.every((a:any)=>a.phase==='ready'&&(splatCount===undefined||a.inputSplats===splatCount))&&
   (instances?d.views.some((v:any)=>v.active&&v.selectedSplats>0):d.views.length===0);
 },{timeout:60000,intervals:[100,250,500]}).toBe(true);
 // Sample after several completed frames, rather than while a retired sorter
 // or a WebGL context-loss event is still being cleaned up.
 await page.evaluate(async()=>{for(let i=0;i<6;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
}

test('repeated shared assets and editor lifetimes release workers, textures and framebuffers',async({page,context})=>{
 test.setTimeout(240000);
 await context.addInitScript(()=>{
  // Count browser resource lifecycle through public APIs only. A context loss
  // releases its outstanding GPU handles even when no delete call is needed.
  const NativeWorker=window.Worker,workers=new Set<Worker>();let createdWorkers=0,terminatedWorkers=0,lostContexts=0;
  class CountedWorker extends NativeWorker{
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);workers.add(this);createdWorkers++;}
   override terminate(){if(workers.delete(this))terminatedWorkers++;super.terminate();}
  }
  window.Worker=CountedWorker;
  const textures=new Set<WebGLTexture>(),framebuffers=new Set<WebGLFramebuffer>();
  let createdTextures=0,deletedTextures=0,createdFramebuffers=0,deletedFramebuffers=0;
  type State={textures:Set<WebGLTexture>;framebuffers:Set<WebGLFramebuffer>};
  const states=new WeakMap<WebGLRenderingContext|WebGL2RenderingContext,State>();
  function state(gl:WebGLRenderingContext|WebGL2RenderingContext){
   let s=states.get(gl);if(s)return s;
   s={textures:new Set(),framebuffers:new Set()};states.set(gl,s);const own=s;
   gl.canvas.addEventListener('webglcontextlost',()=>{
    lostContexts++;for(const t of own.textures)textures.delete(t);for(const f of own.framebuffers)framebuffers.delete(f);own.textures.clear();own.framebuffers.clear();
   });return s;
  }
  for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
   const makeTexture=prototype.createTexture,dropTexture=prototype.deleteTexture,makeFramebuffer=prototype.createFramebuffer,dropFramebuffer=prototype.deleteFramebuffer;
   prototype.createTexture=function(){const t=makeTexture.call(this);if(t){state(this).textures.add(t);textures.add(t);createdTextures++;}return t;};
   prototype.deleteTexture=function(t){if(t){state(this).textures.delete(t);if(textures.delete(t))deletedTextures++;}return dropTexture.call(this,t);};
   prototype.createFramebuffer=function(){const f=makeFramebuffer.call(this);if(f){state(this).framebuffers.add(f);framebuffers.add(f);createdFramebuffers++;}return f;};
   prototype.deleteFramebuffer=function(f){if(f){state(this).framebuffers.delete(f);if(framebuffers.delete(f))deletedFramebuffers++;}return dropFramebuffer.call(this,f);};
  }
  (window as any).entakuResourceProbe=()=>({workers:{created:createdWorkers,terminated:terminatedWorkers,live:workers.size},textures:{created:createdTextures,deleted:deletedTextures,live:textures.size},framebuffers:{created:createdFramebuffers,deleted:deletedFramebuffers,live:framebuffers.size},lostContexts});
 });
 const errors:string[]=[];
 const watch=(p:Page,label:string)=>{p.on('pageerror',e=>errors.push(label+': '+e.message));p.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(label+': '+m.text());});};
 watch(page,'dock');await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const state=await snapshot(page);
 await command(page,{type:'studio-set',scene:{...state.studio,quality:{...state.studio.quality,shadows:'off',ao:'off',reflections:false,gi:'off',msaa:0,fxaa:false},post:{...state.studio.post,enabled:false},exposure:{...state.studio.exposure,mode:'manual',manualExposure:1}}});
 const a=await importAsset(page,0),b=await importAsset(page,1);
 const overlay=await context.newPage();watch(overlay,'overlay');await overlay.setViewportSize({width:640,height:360});await overlay.goto('/overlay');
 await expect(overlay.locator('#scene')).toHaveAttribute('data-gaussian-instances','0');
 let sourceRequests=0;overlay.on('request',r=>{if(r.url().includes(`/api/gaussian-assets/${a.assetId}/file?`))sourceRequests++;});
 const initial={dock:await resources(page),overlay:await resources(overlay)},cycles:any[]=[];
 for(let cycle=0;cycle<3;cycle++){
  await command(page,{type:'avatar-set',profile:profile(a,'100')});await command(page,{type:'avatar-set',profile:profile(a,'101')});await ready(overlay,2,a.splatCount);
  const shared=await diagnostics(overlay),requestsBefore=sourceRequests;expect(shared.assets[0].references).toBe(2);
  await command(page,{type:'avatar-reset',userId:'100'});await ready(overlay,1,a.splatCount);
  const survivor=await diagnostics(overlay);expect(survivor.assets[0].references).toBe(1);
  expect(survivor.assets[0].loadMs).toBe(shared.assets[0].loadMs);expect(survivor.assets[0].decodeAndLodMs).toBe(shared.assets[0].decodeAndLodMs);expect(sourceRequests).toBe(requestsBefore);
  // A different asset replaces the surviving instance; repeated swaps must
  // retire the old source instead of appending another cache entry each time.
  await command(page,{type:'avatar-set',profile:profile(b,'101')});await ready(overlay,1,b.splatCount);
  const swapped=await diagnostics(overlay);expect(swapped.assets).toHaveLength(1);expect(swapped.assets[0].references).toBe(1);
  await page.bringToFront();await personAction(page,page.locator('.person[data-user-id="101"]'),'アバターを調整');
  await expect(page.locator('#gaussian-status')).toHaveAttribute('data-phase','ready',{timeout:60000});await expect(page.locator('#avatar-apply')).toBeEnabled();
  // A second character in the same editor forces preview asset replacement too.
  await page.locator('#gaussian-assets').selectOption(a.assetId);await expect(page.locator('#gaussian-assets')).toHaveValue(a.assetId);
  await expect(page.locator('#gaussian-status')).toHaveAttribute('data-phase','ready',{timeout:60000});
  // Ready means decoding finished. Wait for the view's sorter/LoD workers too,
  // so closing before its first draw cannot accidentally test only the pool.
  await expect.poll(async()=>(await resources(page)).workers.live,{timeout:15000}).toBeGreaterThan(1);
  const editorOpen=await resources(page);await page.locator('#avatar-cancel').click();await expect(page.locator('#avatar-editor')).not.toBeVisible();
  await expect.poll(async()=>(await resources(page)).textures.live,{timeout:15000}).toBeLessThanOrEqual(initial.dock.textures.live);
  await expect.poll(async()=>(await resources(page)).framebuffers.live,{timeout:15000}).toBeLessThanOrEqual(initial.dock.framebuffers.live);
  await expect.poll(async()=>(await resources(page)).workers.live,{timeout:15000}).toBeLessThan(editorOpen.workers.live);
  const editorClosed=await resources(page);
  expect(editorClosed.workers.live).toBeLessThan(editorOpen.workers.live);
  await command(page,{type:'avatar-reset',userId:'101'});await ready(overlay,0);
  const cleared=await diagnostics(overlay),overlayResources=await resources(overlay);
  expect(cleared.instances).toBe(0);expect(cleared.assets).toEqual([]);expect(cleared.views).toEqual([]);
  cycles.push({cycle,shared,survivor,swapped,editorOpen,editorClosed,cleared,overlayResources});
  if(cycle>0){
   const warm=cycles[0];
   // Spark retains a bounded decoder-worker pool; compare with a warmed, empty
   // runtime, not an unsupported claim that every shared worker must be zero.
   expect(editorClosed.workers.live).toBeLessThanOrEqual(warm.editorClosed.workers.live);
   expect(overlayResources.workers.live).toBeLessThanOrEqual(warm.overlayResources.workers.live);
   expect(overlayResources.textures.live).toBeLessThanOrEqual(warm.overlayResources.textures.live+2);
   expect(overlayResources.framebuffers.live).toBeLessThanOrEqual(warm.overlayResources.framebuffers.live+1);
   expect(cleared.rendererMemory.textures).toBeLessThanOrEqual(warm.cleared.rendererMemory.textures+2);
   expect(cleared.rendererMemory.geometries).toBeLessThanOrEqual(warm.cleared.rendererMemory.geometries+2);
   expect(cleared.rendererMemory.programs).toBeLessThanOrEqual(warm.cleared.rendererMemory.programs+2);
  }
 }
 mkdirSync('.work/gaussian',{recursive:true});writeFileSync('.work/gaussian/resource-lifetimes.json',JSON.stringify({initial,cycles,measurement:'Public Worker lifecycle + WebGL handle counts + Three renderer.info; not GPU memory bytes'},null,2));
 expect(errors).toEqual([]);
});
