import {expect,test} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
let probe='';
test.beforeAll(()=>{
 execFileSync('bun',['build','tests/helpers/exposure-probe.ts','--target=browser','--outfile=.work/exposure-probe.js'],{stdio:'pipe'});
 probe=readFileSync('.work/exposure-probe.js','utf8');
});
test('AgX exposure changes the world but not icons, real custom avatar pixels, labels or depth',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/exposure-probe',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas></canvas><script type="module" src="/static/exposure-probe.js"></script></body></html>'}));
 await page.route('**/static/exposure-probe.js',route=>route.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/exposure-probe');await page.waitForFunction(()=>!!(window as any).exposureProbe);
 const bright=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.manual(1);return p.pixels();});
 const dark=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.manual(.0001);return p.pixels();});
 expect(bright.world[0]).toBeGreaterThan(dark.world[0]+60);
 for(const subject of ['icon','avatar','label'])expect(bright[subject]).toEqual(dark[subject]);
 expect(dark.icon[0]).toBeGreaterThan(dark.icon[1]+100);expect(dark.avatar[2]).toBeGreaterThan(dark.avatar[0]+100);
 expect(Math.abs(dark.occlusion[0]-dark.occlusion[1])).toBeLessThan(3);expect(dark.alpha[3]).toBe(0);
 const auto=await page.evaluate(()=>{const p=(window as any).exposureProbe;return p.auto();});
 expect(auto.exposureStatus).toBe('AUTO');expect(auto.exposure).toBeLessThan(.01);expect(auto.fallbackLights).toBe(false);
 const hidden=await page.evaluate(()=>(window as any).exposureProbe.hideDisplay(true));expect(hidden.exposure).toBeCloseTo(auto.exposure,6);
 const compensated=await page.evaluate(()=>(window as any).exposureProbe.compensate(1));expect(compensated.exposure).toBeCloseTo(hidden.exposure*2,6);
 await page.waitForTimeout(650);const report=await page.evaluate(()=>(window as any).exposureProbe.report());expect(report.exposureStatus).toBe('AUTO');
 expect(errors).toEqual([]);
});
test('Dock defaults to auto and supports the provided fixed comparison without resetting a shot',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 await page.locator('#exposure-panel > summary').click();await expect(page.locator('#exposure-auto')).toBeChecked();
 await expect(overlay.locator('#scene')).toHaveAttribute('data-exposure-status','AUTO');
 await page.locator('.person').first().getByRole('button',{name:'この人を撮る',exact:true}).click();await expect(page.locator('#shot')).toHaveText('SINGLE');await page.waitForTimeout(1700);
 const before=await overlay.locator('#scene').getAttribute('data-camera-position');
 await page.locator('#exposure-controls > details > summary').click();await page.locator('#exposure-reference').click();
 await expect(overlay.locator('#scene')).toHaveAttribute('data-exposure-status','MANUAL');
 await expect.poll(async()=>Number(await overlay.locator('#scene').getAttribute('data-exposure'))).toBeCloseTo(2**.8/683,8);
 await expect(overlay.locator('#scene')).toHaveAttribute('data-fallback-lights','false');await expect(page.locator('#shot')).toHaveText('SINGLE');
 expect(await overlay.locator('#scene').getAttribute('data-camera-position')).toBe(before);
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#exposure-panel > summary').click();
 await expect(page.locator('#exposure-auto')).not.toBeChecked();await expect(page.locator('#exposure-lighting')).toHaveValue('studio');
 await page.locator('#exposure-reset').click();await expect(page.locator('#exposure-auto')).toBeChecked();
 await expect(overlay.locator('#scene')).toHaveAttribute('data-exposure-status','AUTO');await page.waitForTimeout(1400);
 await page.locator('#exposure-lock').click();await expect(page.locator('#exposure-auto')).not.toBeChecked();
 await page.locator('#exposure-reset').click();await page.locator('#auto').click();
});

test('GLTFLoader preserves high-unit model lights and auto exposure avoids a whiteout',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 const snapshot=()=>page.evaluate(()=>new Promise<any>((resolve,reject)=>{const w=new WebSocket('ws://'+location.host+'/ws');const timer=setTimeout(()=>{w.close();reject(new Error('SNAPSHOT_TIMEOUT'));},3000);w.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.type==='snapshot'){clearTimeout(timer);w.close();resolve(m.state);}};w.onerror=()=>{clearTimeout(timer);reject(new Error('SNAPSHOT_FAILED'));};}));
 const original=(await snapshot()).studio;
 const apply=async(scene:any)=>{const state=await snapshot();const status=await page.evaluate(async({scene,revision})=>{const r=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'studio-set',scene,expectedRevision:revision,requestId:crypto.randomUUID()})});return r.status;},{scene,revision:state.revision});expect(status).toBe(200);};
 try{
  // Synthetic interoperability fixture, not the user's private GLB. It follows the provided
  // high-unit light configuration (7 spots + 1 point + 1 sun) to reproduce saturation.
  const bundle=await page.evaluate(async()=>{
   const lights=[...Array.from({length:7},()=>({type:'spot',intensity:73374,color:[1,.95,.8],spot:{innerConeAngle:.3,outerConeAngle:.8}})),{type:'point',intensity:3000,color:[1,1,1]},{type:'directional',intensity:341.5,color:[1,1,1]}];
   const gltf={asset:{version:'2.0'},extensionsUsed:['KHR_lights_punctual'],extensions:{KHR_lights_punctual:{lights}},scene:0,scenes:[{nodes:lights.map((_,i)=>i)}],nodes:lights.map((_,i)=>({translation:[i%3-1,5,Math.floor(i/3)-1],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],extensions:{KHR_lights_punctual:{light:i}}}))};
   const form=new FormData();form.append('file:lights.gltf',new File([JSON.stringify(gltf)],'lights.gltf',{type:'model/gltf+json'}));
   const r=await fetch('/api/studio/import',{method:'POST',body:form});if(!r.ok)throw new Error(await r.text());return r.json();
  });
  const scene={...original,broadcast:{enabled:false,title:'',subtitle:''},camera:{blockers:[]},exposure:{mode:'auto',compensationEV:0,manualExposure:1,lighting:'auto'},objects:[{id:'lighting-fixture',kind:'model',bundleId:bundle.bundleId,transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}},{id:'gray-floor',kind:'plane',size:[20,40],color:'#808080',transform:{position:[0,-.05,0],yawDeg:0,scale:[1,1,1]}}]};
  await apply(scene);await expect(overlay.locator('#scene')).toHaveAttribute('data-authored-lights','9');await expect(overlay.locator('#scene')).toHaveAttribute('data-fallback-lights','false');await expect(overlay.locator('#scene')).toHaveAttribute('data-exposure-status','AUTO');
  await expect.poll(async()=>Number(await overlay.locator('#scene').getAttribute('data-exposure'))).toBeLessThan(.03);
  const whiteness=async()=>{const png=await overlay.locator('#scene').screenshot();return overlay.evaluate(async b64=>{const img=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d')!;x.drawImage(img,0,0);img.close();const d=x.getImageData(0,0,c.width,c.height).data;let all=0,white=0;for(let i=0;i<d.length;i+=4){if(d[i+3]!<250)continue;all++;if(d[i]!>247&&d[i+1]!>247&&d[i+2]!>247)white++;}return white/Math.max(1,all);},png.toString('base64'));};
  await page.waitForTimeout(1800);const autoWhite=await whiteness();await overlay.screenshot({path:'.work/high-unit-studio-auto.png',omitBackground:true});
  await apply({...scene,exposure:{...scene.exposure,mode:'manual',manualExposure:1}});await expect(overlay.locator('#scene')).toHaveAttribute('data-exposure-status','MANUAL');
  const manualWhite=await whiteness();await overlay.screenshot({path:'.work/high-unit-studio-manual.png',omitBackground:true});
  expect(manualWhite).toBeGreaterThan(autoWhite+.20);
 }finally{await apply(original);}
});


test('AO, SSR and FXAA preserve avatar RGB, transparent background and world-depth occlusion',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/exposure-probe',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas></canvas><script type="module" src="/static/exposure-probe.js"></script></body></html>'}));
 await page.route('**/static/exposure-probe.js',route=>route.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/exposure-probe');await page.waitForFunction(()=>!!(window as any).exposureProbe);
 const baseline=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.manual(.001);return {pixels:p.pixels(),memory:p.memory()};});
 for(const q of [{ao:'gtao'},{reflections:true},{fxaa:true},{ao:'gtao',reflections:true,fxaa:true},{gi:'ssgi'},{gi:'ssgi',ao:'gtao',reflections:true,fxaa:true}]){
  const a=await page.evaluate(q=>{const p=(window as any).exposureProbe;const r=p.quality(q);p.manual(1);return {report:r,pixels:p.pixels()};},q);
  expect(a.report.qualityStatus).toBe('EFFECTS');
  const b=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.manual(.0001);return p.pixels();});
  for(const key of ['icon','avatar','label']){expect(a.pixels[key]).toEqual(b[key]);expect(b[key]).toEqual(baseline.pixels[key]);}
  expect(b.alpha[3]).toBe(0);expect(Math.abs(b.occlusion[0]-b.occlusion[1])).toBeLessThan(4);
 }
 const end=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.quality({ao:'off',reflections:false,fxaa:false});p.manual(.001);return {pixels:p.pixels(),memory:p.memory()};});
 expect(end.memory.textures).toBeLessThanOrEqual(baseline.memory.textures+1);
 expect(errors).toEqual([]);
});


test('lens effects retain display RGB/depth and four-times speech glow widens the actual silhouette',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/exposure-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><script type="module" src="/static/exposure-probe.js"></script>'}));await page.route('**/static/exposure-probe.js',r=>r.fulfill({contentType:'text/javascript',body:probe}));await page.goto('/exposure-probe');await page.waitForFunction(()=>!!(window as any).exposureProbe);
 const baseline=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.manual(.001);return p.pixels();});
 for(const post of [{saturation:1.2,contrast:1.2},{bloom:true,bloomThreshold:.5,bloomStrength:.4},{dof:true,maxBlur:8,aperture:.01},{saturation:1.2,contrast:1.2,bloom:true,dof:true}]){
  const result=await page.evaluate(value=>{const p=(window as any).exposureProbe;p.post(value);return p.pixels();},post);
  for(const id of ['icon','avatar','label'])expect(result[id]).toEqual(baseline[id]);expect(Math.abs(result.occlusion[0]-result.occlusion[1])).toBeLessThan(4);expect(result.alpha[3]).toBe(0);
 }
 const widths=await page.evaluate(()=>{const p=(window as any).exposureProbe;p.post({});const count=()=>{const a=p.capture();let n=0;for(let i=0;i<a.length;i+=4)if(a[i+1]>a[i]+30&&a[i+1]>a[i+2]+30)n++;return n;};p.glow(0);const base=count();p.glow(1);const thin=count()-base;p.glow(4);const thick=count()-base;return {thin,thick};});
 console.log('speech glow silhouette pixels',widths);expect(widths.thin).toBeGreaterThan(0);expect(widths.thick).toBeGreaterThan(widths.thin*2.5);
 await page.locator('canvas').screenshot({path:'.work/rc7-speech-glow.png',omitBackground:true});expect(errors).toEqual([]);
});
