import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {platform,release,cpus} from 'node:os';
const software=process.argv.includes('--software');
const out='.work/native-benchmark';await mkdir(out,{recursive:true});
const bundle=await Bun.build({entrypoints:['tests/helpers/gaussian-native-benchmark.ts'],target:'browser',minify:false});if(!bundle.success)throw new Error(bundle.logs.join('\n'));
const script=await bundle.outputs[0]!.text();
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{const p=new URL(request.url).pathname;if(p==='/')return new Response('<body style="margin:0;background:#151d29"><canvas></canvas><script type="module" src="/probe.js"></script>',{headers:{'Content-Type':'text/html'}});if(p==='/probe.js')return new Response(script,{headers:{'Content-Type':'text/javascript'}});if(p==='/favicon.ico')return new Response(null,{status:204});return new Response(null,{status:404});}});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 browser=await chromium.launch({headless:true,...(process.env.ENTAKU_CHROMIUM_PATH?{executablePath:process.env.ENTAKU_CHROMIUM_PATH}:{}),args:software?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.port}`);await page.waitForFunction(()=>!!(window as any).nativeBenchmark,{},{timeout:180000});
 const gpu=await page.evaluate(()=>(window as any).nativeBenchmark.renderer);
 if(!software&&/swiftshader|llvmpipe|software/i.test(gpu))throw new Error('HARDWARE_RENDERER_REQUIRED: '+gpu);
 const cases=[];
 for(const count of [1,8] as const)for(const split of [false,true])for(const shadows of [false,true])for(const ssr of [false,true])cases.push({count,split,shadows,ssr,native:true,width:1920,height:1080,samples:60});
 for(const split of [false,true])cases.push({count:8 as const,split,shadows:true,ssr:true,native:false,width:1920,height:1080,samples:60});
 cases.push({count:8 as const,split:false,shadows:true,ssr:true,native:true,width:1920,height:1080,samples:60,lights:8 as const,moving:true});
 const results=[];
 for(let i=0;i<cases.length;i++){
  const result=await page.evaluate(options=>(window as any).nativeBenchmark.run(options),cases[i]);
  const {image,...record}=result;results.push(record);await writeFile(`${out}/case-${String(i).padStart(2,'0')}.png`,Buffer.from(image.split(',')[1],'base64'));
  console.log(JSON.stringify({i,options:record.options,frameMs:record.frameMs,gpuMs:record.gpuMs,draws:record.after.draws}));
  await writeFile(`${out}/results.json`,JSON.stringify({recordedAt:new Date().toISOString(),browser:browser.version(),os:{platform:platform(),release:release(),cpu:cpus()[0]?.model},renderer:gpu,software,errors,results},null,2));
 }
 if(errors.length)throw new Error(errors.join('\n'));
 await page.evaluate(()=>(window as any).nativeBenchmark.dispose());console.log('NATIVE_BENCHMARK_COMPLETE',out);
}finally{await browser?.close();server.stop(true);}
