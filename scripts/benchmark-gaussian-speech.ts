import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {cpus,platform,release} from 'node:os';

const args=process.argv.slice(2),software=args.includes('--software');
const option=(key:string,fallback:string)=>{const index=args.indexOf(key);if(index<0)return fallback;const value=args[index+1];if(!value||value.startsWith('--'))throw new Error('INVALID_BENCHMARK_OPTIONS');return value;};
const repository=resolve(option('--repository','.')),output=resolve(option('--output','.work/gaussian/speech-benchmark.json'));
const bundle=await Bun.build({entrypoints:[join(repository,'tests/helpers/gaussian-speech-probe.ts')],target:'browser'});
if(!bundle.success)throw new AggregateError(bundle.logs,'BENCH_BUILD_FAILED');
const code=await bundle.outputs[0]!.text();
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{
 const path=new URL(request.url).pathname;
 if(path==='/probe.js')return new Response(code,{headers:{'Content-Type':'text/javascript'}});
 if(path==='/')return new Response('<body style="margin:0"><canvas></canvas><script type="module" src="/probe.js"></script>',{headers:{'Content-Type':'text/html'}});
 return new Response(null,{status:path==='/favicon.ico'?204:404});
}});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 browser=await chromium.launch({headless:true,...(process.env.ENTAKU_CHROMIUM_PATH?{executablePath:process.env.ENTAKU_CHROMIUM_PATH}:{}),args:software?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:[]});
 const page=await browser.newPage({viewport:{width:480,height:480},deviceScaleFactor:1});
 const errors:string[]=[],settles:unknown[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{
  if(message.type()==='error')errors.push(message.text());
  const prefix='ENTAKU_SPEECH_SETTLE_END ';
  if(message.text().startsWith(prefix))settles.push(JSON.parse(message.text().slice(prefix.length)));
 });
 await page.goto(`http://127.0.0.1:${server.port}`);
 await page.waitForFunction(()=>!!(window as any).gaussianSpeechProbe,{},{timeout:90_000});
 const renderer=await page.evaluate(()=>{
  const gl=document.querySelector('canvas')!.getContext('webgl2')!,extension=gl.getExtension('WEBGL_debug_renderer_info');
  return String(extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
 });
 if(!software&&/swiftshader|llvmpipe|software/i.test(renderer))throw new Error('HARDWARE_RENDERER_REQUIRED: '+renderer);
 await page.evaluate(async()=>{const probe=(window as any).gaussianSpeechProbe;await probe.settle({speaking:'none'});probe.save('bench-warm');});
 const result=await page.evaluate(async()=>{
  const probe=(window as any).gaussianSpeechProbe,started=performance.now();
  const state=await probe.settle({mode:2,glowScale:4});
  // save() performs synchronous readPixels: include GPU completion rather than
  // reporting only the time spent submitting asynchronous WebGL commands.
  probe.save('bench-halo');
  return {settleAndReadbackMs:performance.now()-started,width:state.width,height:state.height,inputSplats:state.inputSplats,selectedSplats:state.runtime.views.map((view:any)=>view.selectedSplats),appearance:probe.compare('bench-warm','bench-halo')};
 });
 const record={measuredAt:new Date().toISOString(),sourceRepository:repository,browser:browser.version(),renderer,softwareRequested:software,os:{platform:platform(),release:release(),cpu:cpus()[0]?.model},case:{mode:2,glowScale:4},...result,settles,errors};
 await mkdir(dirname(output),{recursive:true});await Bun.write(output,JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify(record,null,2));
 await page.evaluate(()=>(window as any).gaussianSpeechProbe.dispose());
 if(errors.length)throw new Error('BENCHMARK_PAGE_ERROR: '+errors.join('\n'));
}finally{await browser?.close();await server.stop(true);}
