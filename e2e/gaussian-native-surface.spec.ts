import {expect,test,type Page} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
let probe='';
test.beforeAll(()=>{mkdirSync('.work/gaussian',{recursive:true});execFileSync('bun',['build','tests/helpers/gaussian-render-probe.ts','--target=browser','--outfile=.work/gaussian/native-probe.js']);probe=readFileSync('.work/gaussian/native-probe.js','utf8');});
async function setup(page:Page){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/native-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas></canvas><script type="module" src="/static/native-probe.js"></script></body></html>'}));
 await page.route('**/static/native-probe.js',r=>r.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/native-probe');await page.waitForFunction(()=>!!(window as any).gaussianRenderProbe,{},{timeout:90000});return errors;
}
test('proxy-free original splats supply SSR geometry and native PCF shadows',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const r=await page.evaluate(async()=>{
  const p=(window as any).gaussianRenderProbe;
  await p.settle({proxy:false});p.save('plain');
  await p.settle({native:true});p.save('native');const invisible=p.compare('plain','native');
  await p.settle({native:true,quality:{reflections:false}});p.save('r0');
  await p.settle({native:true,quality:{reflections:true}});p.save('r1');
  await p.settle({native:true,color:'blue',quality:{reflections:false}});p.save('b0');
  await p.settle({native:true,color:'blue',quality:{reflections:true}});p.save('b1');
  const ssr=p.reflectionAppearance('r0','r1','b0','b1');
  await p.settle({native:true,quality:{shadows:'soft'}});p.save('shadow');const shadow=p.compare('plain','shadow','floor'),before=p.status();const cameraOnly=await p.moveCamera(1.0);await p.moveCamera(0);
  await p.moveLight(2.5);p.save('moveOn');const after=p.status();
  await p.settle({native:true,lightX:2.5});p.save('moveOff');const moved=p.shadowMovement('plain','shadow','moveOff','moveOn');
  await p.settle({native:true,remove:true});p.save('absentOff');await p.settle({native:true,remove:true,quality:{shadows:'soft'}});p.save('absentOn');
  const absent=p.compare('absentOff','absentOn');
  await p.settle({native:true,color:'blue',quality:{reflections:true,shadows:'soft'}},8);
  return {invisible,ssr,shadow,moved,absent,before,cameraOnly,after,status:p.status()};
 });
 console.log('NATIVE GS',JSON.stringify(r));writeFileSync('.work/gaussian/native-results.json',JSON.stringify(r,null,2));
 await page.locator('canvas').screenshot({path:'.work/gaussian/native-shadow-ssr.png',omitBackground:true});
 expect(errors).toEqual([]);expect(r.invisible.changed).toBe(0);expect(r.ssr.changed).toBeGreaterThan(50);
 expect(r.ssr.redGain).toBeGreaterThan(500);expect(r.ssr.blueGain).toBeGreaterThan(500);
 expect(r.moved.beforeDarkened).toBeGreaterThan(50);expect(r.moved.afterDarkened).toBeGreaterThan(50);expect(r.moved.shifted).toBeGreaterThan(50);expect(r.absent.changed).toBeLessThan(10);
 expect(r.cameraOnly.native.draws.shadow).toBe(r.before.native.draws.shadow);
 expect(r.status.native.draws.shadow).toBeGreaterThan(0);expect(r.status.native.draws.normal).toBeGreaterThan(0);
});

test('native depth is the nearest actual splat; normals follow covariance and inverse-transpose transforms',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 execFileSync('bun',['build','tests/helpers/gaussian-surface-probe.ts','--target=browser','--outfile=.work/gaussian/surface-probe.js']);
 await page.route('**/surface-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><script type="module" src="/static/surface-probe.js"></script>'}));
 await page.route('**/static/surface-probe.js',r=>r.fulfill({contentType:'text/javascript',body:readFileSync('.work/gaussian/surface-probe.js','utf8')}));
 await page.goto('/surface-probe');await page.waitForFunction(()=>!!(window as any).gaussianSurfaceProbe);
 const r=await page.evaluate(()=>(window as any).gaussianSurfaceProbe.run());writeFileSync('.work/gaussian/native-depth-normal.json',JSON.stringify(r,null,2));console.log('depth/normal',r);
 expect(errors).toEqual([]);expect(r.plane.depth).toBeCloseTo(3,3);
 expect(r.forwardOrder).toEqual(r.reverseOrder);expect(r.forwardOrder.depth).toBeCloseTo(2.5,3);
 const decode=(rgba:number[])=>rgba.slice(0,3).map(v=>v/255*2-1),n=decode(r.plane.rgba);
 expect(n[0]).toBeCloseTo(Math.sin(.4),1);expect(n[1]).toBeCloseTo(0,1);expect(n[2]).toBeCloseTo(Math.cos(.4),1);
 expect(r.thinRejected.rgba[3]).toBe(0);expect(r.thinRejected.depth).toBeCloseTo(20,2);expect(r.thinAccepted.rgba[3]).toBe(255);
 const x=Math.sin(.4)/1.8,z=Math.cos(.4)/.5,length=Math.hypot(x,z),expectedX=(x*Math.cos(.35)+z*Math.sin(.35))/length,expectedZ=(-x*Math.sin(.35)+z*Math.cos(.35))/length;
 expect(decode(r.transformed.rgba)[0]).toBeCloseTo(expectedX,1);expect(decode(r.transformed.rgba)[2]).toBeCloseTo(expectedZ,1);
 for(const p of [r.isotropic,r.needle]){expect(decode(p.rgba)[0]).toBeCloseTo(0,1);expect(decode(p.rgba)[2]).toBeCloseTo(1,1);}
 await page.evaluate(()=>(window as any).gaussianSurfaceProbe.dispose());
});

test('proxy-free split, LoD, post and spot-light geometry keep independent views and no residual shadows',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const r=await page.evaluate(async()=>{
  const p=(window as any).gaussianRenderProbe;
  await p.settle({native:true,spot:true});p.save('off');
  await p.settle({native:true,spot:true,quality:{shadows:'soft'}});p.save('on');
  await p.moveLight(2.5);p.save('movedOn');
  await p.settle({native:true,spot:true,lightX:2.5});p.save('movedOff');
  const spot=p.shadowMovement('off','on','movedOff','movedOn');
  await p.settle({native:true,alphaClip:.99,quality:{shadows:'soft'}});p.save('clipped');
  await p.settle({native:true,alphaClip:.99});p.save('clippedOff');const highThreshold=p.compare('clipped','clippedOff');
  const views=[];for(const swapSplit of [false,true,false])views.push(await p.settle({native:true,rear:true,split:true,swapSplit,lodBudget:1000,quality:{reflections:true,shadows:'soft',msaa:4}},24));
  const included=await p.settle({native:true,rear:true,width:800,height:450,quality:{reflections:true,shadows:'soft',ao:'gtao',msaa:4,fxaa:true},post:{enabled:true,excludeAvatars:false,dof:true,bloom:true,aperture:.005,maxBlur:4}});
  await p.settle({native:true});p.save('restored');await p.settle({proxy:false});p.save('baseline');const restored=p.compare('baseline','restored');
  return {spot,highThreshold,views,included,restored};
 });
 writeFileSync('.work/gaussian/native-split-spot.json',JSON.stringify(r,null,2));
 expect(errors).toEqual([]);expect(r.spot.beforeDarkened).toBeGreaterThan(50);expect(r.spot.afterDarkened).toBeGreaterThan(50);expect(r.spot.shifted).toBeGreaterThan(50);
 expect(r.highThreshold.changed).toBeLessThan(10);expect(r.restored.changed).toBe(0);
 for(let i=0;i<r.views.length;i++){
  const state=r.views[i],swapped=i===1;
  expect(state.activeViews).toHaveLength(2);expect(state.stats[swapped?'leftBlue':'leftRed']).toBeGreaterThan(500);expect(state.stats[swapped?'rightRed':'rightBlue']).toBeGreaterThan(500);
  expect(state.native.visibleInstances).toBe(2);expect(state.native.draws.normal).toBeGreaterThan(0);expect(state.runtime.views.length).toBeLessThanOrEqual(3);
 }
 expect(r.included.quality).toBe('EFFECTS');expect(r.included.stats.transparent).toBeGreaterThan(1000);expect(r.included.stats.red).toBeGreaterThan(100);
});
