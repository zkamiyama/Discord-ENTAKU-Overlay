import {chromium} from '@playwright/test';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2),software=args.includes('--software');
const arg=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]??fallback;};
const frames=Number(arg('--frames','60')),width=Number(arg('--width','1280'));
if(!Number.isInteger(frames)||frames<5||frames>600||![960,1280,1920].includes(width))throw new Error('INVALID_BENCHMARK_OPTIONS');
const repository=resolve(import.meta.dir,'../..');
const build=await Bun.build({entrypoints:[resolve(import.meta.dir,'probe.ts')],target:'browser',format:'esm'});
if(!build.success)throw new Error('MISSKEY_BENCHMARK_BUILD_FAILED');
const bundle=await build.outputs[0]!.text();
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
  return new URL(request.url).pathname==='/probe.js'?new Response(bundle,{headers:{'Content-Type':'text/javascript'}}):new Response('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#233c41}canvas{display:block}</style></head><body><canvas></canvas><script type="module" src="/probe.js"></script></body></html>',{headers:{'Content-Type':'text/html'}});
}});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if(!executablePath){for(const candidate of ['/usr/bin/chromium','/usr/bin/google-chrome','/opt/google/chrome/chrome']){try{await access(candidate);executablePath=candidate;break;}catch{}}}
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:software?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:[]});
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);await page.waitForFunction(()=>typeof (window as any).runMisskeyCardBenchmark==='function');
  const device=await page.evaluate(()=>(window as any).misskeyCardDevice);
  const softwareDetected=/swiftshader|llvmpipe|software|basic render/i.test(device.renderer);
  if(!software&&softwareDetected)throw new Error('SOFTWARE_RENDERER_DETECTED: rerun with --software; this is not a hardware result');
  const results=[];
  for(const split of [false,true])for(const count of [0,30])results.push(await page.evaluate(options=>(window as any).runMisskeyCardBenchmark(options),{count,split,frames,width}));
  const churn=await page.evaluate(()=>(window as any).churnMisskeyCards());
  const stableResources=results.every(r=>r.memoryAfterDispose.textures===0&&r.memoryAfterDispose.geometries===0)&&churn.retained.stats.allocated===30&&churn.retained.stats.textureBytes===15*1024*1024&&churn.memoryAfterDispose.textures===0&&churn.memoryAfterDispose.geometries===0;
  const unchangedPixels=results.every(r=>r.staticTextureUpdateDelta===0);
  const output=resolve(repository,'.work/misskey-cards');await mkdir(output,{recursive:true});
  const captures=[];
  for(const [name,sample] of [['japanese',0],['english',1],['long',2],['emoji',3],['field',null]] as const){
    const capture=await page.evaluate(sample=>(window as any).captureMisskeyCards(sample),sample);
    const path=resolve(output,`${name}.png`);await page.locator('canvas').screenshot({path});captures.push({name,width:capture.width,height:capture.height,path:`.work/misskey-cards/${name}.png`});
  }
  await page.evaluate(()=>(window as any).disposeMisskeyBenchmark());
  if(errors.length)throw new Error(`MISSKEY_BENCHMARK_PAGE_ERROR: ${errors.join('; ')}`);
  let commit='unknown';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();}catch{}
  const sourceFiles=['src/web/overlay/misskey-cards.ts','src/geometry/misskey-card-layout.ts','experiments/misskey-cards/probe.ts','experiments/misskey-cards/run.ts'];
  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,new Bun.CryptoHasher('sha256').update(await Bun.file(resolve(repository,path)).arrayBuffer()).digest('hex')])));
  const report={kind:'synthetic-misskey-geometry-rendering',measuredAt:new Date().toISOString(),baseCommit:commit,workingTree:true,sourceHashes,runtime:Bun.version,device,softwareRequested:software,softwareDetected,conditions:{pixelRatio:1,textureSize:[512,256],mipmaps:false,warmupFrames:20,frames,width,background:'six capsule silhouettes and a table',timing:'CPU submission and CPU+GPU completion via 1x1 readRenderTargetPixels; not an OBS or full-app fps result'},stableResources,unchangedPixels,results,churn,captures};
  const reportPath=resolve(repository,arg('--output','docs/measurements/misskey-geometry.json'));await mkdir(resolve(reportPath,'..'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!stableResources||!unchangedPixels)throw new Error('MISSKEY_BENCHMARK_INVARIANT_FAILED');
}finally{await browser?.close();await server.stop(true);}
