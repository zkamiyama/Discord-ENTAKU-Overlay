import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const args=process.argv.slice(2),software=args.includes('--software');
const arg=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]??fallback;};
const frames=Number(arg('--frames','120')),width=Number(arg('--width','1920'));
if(!Number.isInteger(frames)||frames<5||frames>3600||![480,960,1280,1920].includes(width))throw Error('INVALID_BENCHMARK_OPTIONS');
const built=await Bun.build({entrypoints:['tests/helpers/render-benchmark.ts'],target:'browser',format:'esm'});
if(!built.success)throw Error('BENCHMARK_BUILD_FAILED');const js=await built.outputs[0]!.text();
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return new URL(req.url).pathname==='/probe.js'?new Response(js,{headers:{'Content-Type':'text/javascript'}}):new Response('<canvas></canvas><script type="module" src="/probe.js"></script>',{headers:{'Content-Type':'text/html'}});}});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 browser=await chromium.launch({headless:!args.includes('--headed'),args:software?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:[]});
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.name));
 await page.goto(`http://127.0.0.1:${server.port}`);await page.waitForFunction(()=>typeof (window as any).renderBenchmark==='function');
 const results=[];
 for(const count of [6,16,32])for(const split of [false,true])for(const high of [false,true]){
  results.push(await page.evaluate(async options=>(window as any).renderBenchmark(options),{count,split,high,frames,width}));
 }
 if(errors.length)throw Error('BENCHMARK_PAGE_ERROR');
 const teardown=await page.evaluate(()=>(window as any).disposeRenderBenchmark());
 const baseline=results[0]?.memoryAfterDispose;
 const stableResources=results.every(r=>r.memoryAfterDispose.geometries===baseline.geometries&&r.memoryAfterDispose.textures===baseline.textures);
 const report={kind:'synthetic-webgl-frame-time',runtime:Bun.version,softwareRequested:software,frames,width,stableResources,retainedBaseline:baseline,teardown,results};
 await mkdir('.work',{recursive:true});const path='.work/render-benchmark.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));console.log('Saved '+path);
 if(!stableResources)throw Error('BENCHMARK_RESOURCE_GROWTH');
}finally{await browser?.close();await server.stop(true);}
