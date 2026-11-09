import {expect,test} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
let probe='';
test.beforeAll(()=>{execFileSync('bun',['build','tests/helpers/quality-probe.ts','--target=browser','--outfile=.work/quality-probe.js']);probe=readFileSync('.work/quality-probe.js','utf8');});
test('SSR leaves thin non-reflecting GLB-like surfaces unchanged at both effect resolutions',async({page})=>{
 const errors:string[]=[];page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/quality-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><script type="module" src="/static/quality-probe.js"></script>'}));
 await page.route('**/static/quality-probe.js',r=>r.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/quality-probe');await page.waitForFunction(()=>!!(window as any).qualityProbe);
 const result=await page.evaluate(()=>{const p=(window as any).qualityProbe;p.thin();p.render({reflections:false});const before=p.capture();const changes=[];
  for(const scale of [.5,1]){p.render({reflections:true,reflectionOpacity:0,effectsScale:scale});const after=p.capture();let max=0;for(let i=0;i<after.length;i++)max=Math.max(max,Math.abs(after[i]-before[i]));changes.push(max);}return changes;
 });
 await page.locator('canvas').screenshot({path:'.work/rc6-thin-surfaces-ssr.png'});console.log('SSR max pixel error',result);expect(result).toEqual([0,0]);expect(errors).toEqual([]);
});
test('MSAA resolves geometry edges and SSGI adds local diffuse color, not a uniform exposure change',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/quality-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><script type="module" src="/static/quality-probe.js"></script>'}));
 await page.route('**/static/quality-probe.js',r=>r.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/quality-probe');await page.waitForFunction(()=>!!(window as any).qualityProbe);
 const aa=await page.evaluate(()=>{const p=(window as any).qualityProbe;p.edges();const counts=[];
  for(const samples of [0,4]){const r=p.render({msaa:samples});const d=p.capture();let partial=0;for(let i=0;i<d.length;i+=4)if(d[i]>8&&d[i]<247)partial++;counts.push({partial,samples:r.samples});}return counts;
 });
 console.log('AA edge coverage',aa);expect(aa[1]!.samples).toBe(4);expect(aa[1]!.partial).toBeGreaterThan(aa[0]!.partial+100);
 await page.locator('canvas').screenshot({path:'.work/rc6-msaa-edges.png'});
 const before=await page.evaluate(()=>{const p=(window as any).qualityProbe;p.bounce();p.render({gi:'off'});return p.floorSample();});
 await page.locator('canvas').screenshot({path:'.work/rc6-gi-off.png'});
 const after=await page.evaluate(()=>{const p=(window as any).qualityProbe;return {report:p.render({gi:'ssgi',giStrength:1,giRadius:2.5}),rgb:p.floorSample()};});
 console.log('SSGI floor RGB',before,after.rgb);
 expect(after.report.status).toBe('EFFECTS');expect(after.rgb[0]-before[0]!).toBeGreaterThan(1);
 expect(after.rgb[0]-before[0]!).toBeGreaterThan(after.rgb[1]-before[1]!);
 await page.locator('canvas').screenshot({path:'.work/rc6-gi-on.png'});
 const reflected=await page.evaluate(()=>{const p=(window as any).qualityProbe;p.reflect();p.render({gi:'off',reflections:false});const a=p.capture();p.render({gi:'off',reflections:true,reflectionOpacity:.8});const b=p.capture();let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>8)changed++;return changed;});
 console.log('SSR reflecting pixels',reflected);expect(reflected).toBeGreaterThan(10);
 expect(errors).toEqual([]);
});

test('eight existing lights can render soft shadows, while 2x reports actual GPU samples',async({page})=>{
 const errors:string[]=[];page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/quality-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><script type="module" src="/static/quality-probe.js"></script>'}));
 await page.route('**/static/quality-probe.js',r=>r.fulfill({contentType:'text/javascript',body:probe}));await page.goto('/quality-probe');await page.waitForFunction(()=>!!(window as any).qualityProbe);
 const result=await page.evaluate(()=>{const p=(window as any).qualityProbe;p.shadowRig();return p.render({msaa:2,shadows:'soft',shadowSize:512,shadowLights:8});});
 expect(result.status).toBe('EFFECTS');expect(result.shadowLights).toBe(8);expect([2,4]).toContain(result.samples);expect(errors).toEqual([]);
});
