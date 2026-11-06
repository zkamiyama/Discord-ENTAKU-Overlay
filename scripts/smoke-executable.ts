import { copyFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'entaku-standalone-'));
const executable=join(directory,process.platform==='win32'?'ENTAKU-Overlay.exe':'entaku-overlay');
const env={...process.env,PATH:''}; // No Bun, Node, package manager or browser is on the child PATH.
let server:ReturnType<typeof Bun.spawn>|null=null;
async function run(args:string[]):Promise<string>{
  const child=Bun.spawn([executable,...args],{cwd:directory,env,stdout:'pipe',stderr:'ignore'});
  const timeout=setTimeout(()=>child.kill(),10000);
  try{const out=await new Response(child.stdout).text();const code=await child.exited;if(code!==0)throw new Error('COMPILED_COMMAND_FAILED');return out;}
  finally{clearTimeout(timeout);child.kill();await child.exited;}
}
try{
  await copyFile(resolve(process.platform==='win32'?'dist/ENTAKU-Overlay.exe':'dist/entaku-overlay'),executable);
  if(process.platform!=='win32')await chmod(executable,0o755);
  if(!(await run(['--help'])).includes('ENTAKU'))throw new Error('COMPILED_HELP_FAILED');
  const doctor=JSON.parse(await run(['--doctor']));
  if(doctor.compiled!==true||doctor.platform!==process.platform||doctor.authorization!=='not-attempted')throw new Error('COMPILED_DOCTOR_FAILED');
  const child=Bun.spawn([executable,'--demo','--no-open','--safe-mode','--port','0'],{cwd:directory,env,stdout:'pipe',stderr:'ignore'});server=child;
  const timer=setTimeout(()=>child.kill(),15000);
  const reader=child.stdout.getReader();let text='';
  try{
    for(;;){const {value,done}=await reader.read();if(done)throw new Error('COMPILED_SERVER_EXITED');text+=new TextDecoder().decode(value);if(/Dock:/.test(text))break;}
    const origin=/Overlay: (http:\/\/127\.0\.0\.1:\d+)\/overlay(?:\s|$)/.exec(text)?.[1];if(!origin||text.includes('#key='))throw new Error('COMPILED_SERVER_URL_INVALID');
    const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)});
    const overlay=await fetch(origin+'/overlay',{signal:AbortSignal.timeout(5000)});
    const bundle=await fetch(origin+'/static/overlay.js',{signal:AbortSignal.timeout(5000)});
    if(!health.ok||!overlay.ok||!bundle.ok||(await bundle.text()).length<100000)throw new Error('EMBEDDED_WEB_ASSETS_MISSING');
    for(const path of ['/static/avatar-field.js','/static/decoders/draco/draco_decoder.wasm','/static/decoders/basis/basis_transcoder.wasm']){
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(5000)}),bytes=new Uint8Array(await response.arrayBuffer());
      if(!response.ok||bytes.length<100)throw new Error('EMBEDDED_DECODER_MISSING');
      if(path.endsWith('.wasm')&&(bytes[0]!==0||bytes[1]!==97||bytes[2]!==115||bytes[3]!==109))throw new Error('EMBEDDED_WASM_INVALID');
    }
    // Consume HTTP bodies before stopping the child; no fetch stream is left open.
    await health.arrayBuffer();await overlay.arrayBuffer();
    if(await Bun.file(join(directory,'data','access-keys.json')).exists())throw new Error('OBSOLETE_ACCESS_KEYS_CREATED');
  }finally{clearTimeout(timer);reader.releaseLock();child.kill();await child.exited;server=null;}
}finally{
  if(server){server.kill();await server.exited;}
  // Windows may retain executable/directory handles briefly after process exit.
  // Retry only the documented transient rm errors; never hide a persistent failure.
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Standalone smoke passed: ${process.platform}, PATH empty, copied executable only, HTTP + embedded assets, temporary directory removed, no Discord authorization.`);
