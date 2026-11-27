import {expect,test} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';

test('tilted card meshes follow an animated camera and render both split views independently',async({page})=>{
 test.setTimeout(90000);
 mkdirSync('.work/misskey-cards',{recursive:true});
 execFileSync('bun',['build','experiments/misskey-cards/probe.ts','--target=browser','--outfile=.work/misskey-cards/geometry-probe.js']);
 const bundle=readFileSync('.work/misskey-cards/geometry-probe.js','utf8'),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/misskey-geometry-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><canvas></canvas><script type="module" src="/static/misskey-geometry-probe.js"></script></body></html>'}));
 await page.route('**/static/misskey-geometry-probe.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/misskey-geometry-probe');
 await page.waitForFunction(()=>typeof (window as any).inspectMisskeyGeometryViews==='function');
 const result=await page.evaluate(()=>(window as any).inspectMisskeyGeometryViews());
 writeFileSync('.work/misskey-cards/geometry-views.json',JSON.stringify(result,null,2));
 expect(result.mesh).toBe(true);expect(result.geometry).toBe('PlaneGeometry');
 for(const frame of [...result.animation,...result.rollOnly,...result.forward.views,...result.reverse.views,result.restored]){
  expect(frame.facing).toBeGreaterThan(.8);expect(frame.facing).toBeLessThan(.999);
  expect(frame.centerError).toBeLessThan(1e-6);expect(frame.orthogonality).toBeLessThan(1e-6);
  // A front-facing Sprite has no depth difference between its four corners.
  expect(frame.depthRange).toBeGreaterThan(.1);
 }
 for(const frame of result.animation)expect(frame.white).toBeGreaterThan(1000);
 for(let index=1;index<result.animation.length;index++){
  const before=result.animation[index-1].normal,after=result.animation[index].normal;
  expect(before.reduce((sum:number,value:number,axis:number)=>sum+value*after[axis],0)).toBeGreaterThan(.9);
 }
 for(const frame of result.rollOnly)expect(frame.white).toBeGreaterThan(1000);
 const rollBefore=result.rollOnly[0].up,rollAfter=result.rollOnly[1].up;
 expect(rollBefore.reduce((sum:number,value:number,axis:number)=>sum+value*rollAfter[axis],0)).toBeLessThan(.98);
 for(let panel=0;panel<2;panel++){
  expect(result.forward.panels[panel].white).toBeGreaterThan(1000);
  expect(result.reverse.panels[panel]).toEqual(result.forward.panels[panel]);
  expect(result.reverse.views[panel].matrix).toEqual(result.forward.views[panel].matrix);
 }
 expect(result.forward.views[0].matrix).not.toEqual(result.forward.views[1].matrix);
 expect(result.restored.hash).toBe(result.animation[0].hash);
 expect(result.stats.textureUpdates).toBe(1);expect(result.stats.allocated).toBe(1);
 expect(result.memoryAfterDispose.textures).toBe(0);expect(result.memoryAfterDispose.geometries).toBe(0);
 expect(errors).toEqual([]);
 await page.evaluate(()=>(window as any).disposeMisskeyBenchmark());
});
