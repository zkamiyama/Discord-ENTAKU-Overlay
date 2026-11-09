import {test,expect} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

test('setting save retains mode-dependent disabled controls and numeric values without a sync interval',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 await page.locator('#exposure-panel').evaluate((e:HTMLDetailsElement)=>e.open=true);
 await expect(page.locator('#exposure-manual')).toBeDisabled();await expect(page.locator('#exposure-manual-slider')).toBeDisabled();
 await page.locator('#exposure-ev').fill('0.7');await page.locator('#exposure-ev').dispatchEvent('change');
 await expect(page.locator('#exposure-ev-slider')).toHaveValue('0.7');
 await expect(page.locator('#exposure-manual')).toBeDisabled();await expect(page.locator('#exposure-manual-slider')).toBeDisabled();
 await page.locator('#exposure-auto').uncheck();await expect(page.locator('#exposure-manual')).toBeEnabled();await expect(page.locator('#exposure-manual-slider')).toBeEnabled();
 await page.locator('#exposure-reset').click();await expect(page.locator('#exposure-manual')).toBeDisabled();await expect(page.locator('#exposure-ev-slider')).toHaveValue('0.5');
});

test('ordinary glTF preflight uses the official loader without requesting a WebGL context',async({page})=>{
 execFileSync('bun',['build','src/web/studio/loader.ts','--target=browser','--outfile=.work/loader-test.js']);
 const js=readFileSync('.work/loader-test.js','utf8');
 await page.route('**/static/loader-test.js',r=>r.fulfill({contentType:'text/javascript',body:js}));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const result=await page.evaluate(async()=>{
  const requests:string[]=[];const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:any[]){requests.push(type);return (original as any).call(this,type,...args);} as any;
  const path='/static/loader-test.js';const module=await import(path);
  const gltf=JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]});
  const bundle={bundleId:'test',entry:'empty.gltf',files:[{path:'empty.gltf'}]};
  try{
   const group=await module.loadStudioBundle({localFetch:async(url:string)=>url.endsWith('/test')?Response.json(bundle):new Response(gltf)},undefined,'test');
   module.disposeObject(group);return requests;
  }finally{HTMLCanvasElement.prototype.getContext=original;}
 });
 expect(result.filter(r=>r==='webgl'||r==='webgl2')).toEqual([]);
});
