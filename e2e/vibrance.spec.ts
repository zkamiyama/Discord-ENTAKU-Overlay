import {test,expect} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('natural vibrance shader matches bounded CPU reference for muted colors, high chroma, gray and alpha',async({page})=>{
 execFileSync('bun',['build','tests/helpers/vibrance-probe.ts','--target=browser','--outfile=.work/vibrance-probe.js']);const script=readFileSync('.work/vibrance-probe.js','utf8'),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/vibrance-probe',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><script type="module" src="/static/vibrance-probe.js"></script>'}));
 await page.route('**/static/vibrance-probe.js',r=>r.fulfill({contentType:'text/javascript',body:script}));await page.goto('/vibrance-probe');await page.waitForFunction(()=>!!(window as any).vibranceProbe);
 for(const value of [0,1,1.2,2]){const result=await page.evaluate(value=>(window as any).vibranceProbe(value),value);for(let i=0;i<16;i++)expect(Math.abs(result.output[i]-result.expected[i])).toBeLessThanOrEqual(1);}
 expect(errors).toEqual([]);
});
