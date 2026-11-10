import {chromium,expect,test,type Browser,type BrowserContext,type Page,type TestInfo} from '@playwright/test';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile,chmod,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gaussianFixture} from '../tests/helpers/gaussian.ts';
import type {AppSnapshot} from '../src/contracts/domain.ts';
import type {StoredGaussianAsset} from '../src/assets/gaussian-store.ts';

// This uses the actual compiled distribution, not the shared in-memory E2E
// server. Chromium/SwiftShader evidence does not establish OBS or real-GPU support.
const run=promisify(execFile),evidenceDirectory=resolve('.work/gaussian');
let directory='',executable='',dataDirectory='';
let preflight:Record<string,unknown>={};
interface CompiledServer {child:ChildProcess;closed:Promise<void>;origin:string;output:()=>string}
let server:CompiledServer|undefined;

async function stopServer(value:CompiledServer|undefined):Promise<void>{
  if(!value)return;
  if(value.child.exitCode===null&&value.child.signalCode===null)value.child.kill('SIGTERM');
  const timer=setTimeout(()=>{if(value.child.exitCode===null&&value.child.signalCode===null)value.child.kill('SIGKILL');},5000);
  try{await value.closed;}finally{clearTimeout(timer);}
}
async function startCompiled():Promise<CompiledServer>{
  const child=spawn(executable,['--demo','--no-open','--port','0','--data-dir',dataDirectory],{
    cwd:directory,env:{...process.env,PATH:''},stdio:['ignore','pipe','pipe'],
  });
  let output='';const closed=new Promise<void>(done=>child.once('close',()=>done()));
  child.stdout!.on('data',chunk=>{output=(output+String(chunk)).slice(-64000);});
  child.stderr!.on('data',chunk=>{output=(output+String(chunk)).slice(-64000);});
  let origin='';
  try{
    origin=await new Promise<string>((ready,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('COMPILED_START_TIMEOUT\n'+output)),20000);
      const check=()=>{
        const found=/Overlay: (http:\/\/127\.0\.0\.1:\d+)\/overlay(?:\s|$)/.exec(output)?.[1];
        if(found&&output.includes('Dock:')){clearTimeout(timeout);ready(found);}
      };
      child.stdout!.on('data',check);
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error('COMPILED_SERVER_EXITED_'+code+'\n'+output));});
    });
    return {child,closed,origin,output:()=>output};
  }catch(error){await stopServer({child,closed,origin,output:()=>output});throw error;}
}

interface NetworkEvidence {
  requests:Array<{url:string;method:string;resourceType:string}>;
  blocked:string[];failed:Array<{url:string;error:string|null}>;
  httpErrors:Array<{url:string;status:number}>;webSockets:string[];
  pageErrors:string[];consoleErrors:string[];
}
interface ColdBrowser {browser:Browser;context:BrowserContext;page:Page;network:NetworkEvidence}
async function coldBrowser(origin:string):Promise<ColdBrowser>{
  // Each invocation starts a separate browser process with a new temporary
  // profile. Neither HTTP cache nor a prior WASM/worker instance can satisfy it.
  const browser=await chromium.launch({headless:true,channel:'chromium',
    ...(process.env.ENTAKU_CHROMIUM_PATH?{executablePath:process.env.ENTAKU_CHROMIUM_PATH}:{}),
    args:['--enable-unsafe-swiftshader','--use-angle=swiftshader'],
  });
  try{
    const context=await browser.newContext({baseURL:origin,locale:'ja-JP',viewport:{width:640,height:360},deviceScaleFactor:1,serviceWorkers:'block'});
    const network:NetworkEvidence={requests:[],blocked:[],failed:[],httpErrors:[],webSockets:[],pageErrors:[],consoleErrors:[]};
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.protocol!=='data:'&&url.protocol!=='blob:'&&url.origin!==origin){network.blocked.push(url.href);return route.abort('blockedbyclient');}
      // An optional browser favicon is unrelated to the embedded renderer.
      if(url.origin===origin&&url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
      return route.continue();
    });
    await context.routeWebSocket('**/*',route=>{
      const url=new URL(route.url());network.webSockets.push(url.href);
      if(url.protocol!=='ws:'||url.host!==new URL(origin).host){network.blocked.push(url.href);route.close({code:1008,reason:'Only the compiled local server is allowed'});return;}
      route.connectToServer();
    });
    context.on('request',request=>network.requests.push({url:request.url(),method:request.method(),resourceType:request.resourceType()}));
    context.on('requestfailed',request=>network.failed.push({url:request.url(),error:request.failure()?.errorText??null}));
    context.on('response',response=>{if(response.status()>=400)network.httpErrors.push({url:response.url(),status:response.status()});});
    await context.addInitScript(()=>{
      const evidence={workers:[] as Array<{url:string;messages:number;errors:string[]}>,wasmCompileBytes:[] as number[],wasmErrors:[] as string[]};
      (window as unknown as {executableGaussianEvidence:typeof evidence}).executableGaussianEvidence=evidence;
      const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker {
        constructor(url:string|URL,options?:WorkerOptions){
          const record={url:String(url),messages:0,errors:[] as string[]};
          super(url,options);evidence.workers.push(record);
          this.addEventListener('message',()=>record.messages++);
          this.addEventListener('error',event=>record.errors.push(event.message));
        }
      };
      const compile=WebAssembly.compile.bind(WebAssembly);
      WebAssembly.compile=async bytes=>{
        try{const module=await compile(bytes as BufferSource);evidence.wasmCompileBytes.push(bytes.byteLength);return module;}
        catch(error){evidence.wasmErrors.push(String(error));throw error;}
      };
    });
    const page=await context.newPage();page.on('pageerror',error=>network.pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')network.consoleErrors.push(message.text());});
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    return {browser,context,page,network};
  }catch(error){await browser.close();throw error;}
}
async function snapshot(page:Page):Promise<AppSnapshot>{
  return page.evaluate(()=>new Promise<AppSnapshot>((resolveState,reject)=>{
    const ws=new WebSocket('ws://'+location.host+'/ws');
    const timer=setTimeout(()=>{ws.close();reject(new Error('SNAPSHOT_TIMEOUT'));},10000);
    ws.onerror=()=>{clearTimeout(timer);ws.close();reject(new Error('SNAPSHOT_WEBSOCKET_FAILED'));};
    ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.type==='snapshot'){clearTimeout(timer);ws.close();resolveState(message.state);}};
  }));
}
async function command(page:Page,value:Record<string,unknown>):Promise<void>{
  for(let attempt=0;attempt<4;attempt++){
    const state=await snapshot(page);
    const result=await page.evaluate(async({value,revision})=>{
      const response=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,expectedRevision:revision,requestId:crypto.randomUUID()})});
      return {status:response.status,body:await response.text()};
    },{value,revision:state.revision});
    if(result.status===409&&attempt<3)continue;
    expect(result.status,result.body).toBe(200);return;
  }
}
async function coloredPixels(page:Page,png:Buffer){
  return page.evaluate(async bytes=>{
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let red=0,opaque=0,transparent=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]!>200){opaque++;if(data[i]!>120&&data[i]!>data[i+1]!*1.7&&data[i]!>data[i+2]!*1.7)red++;}
      if(data[i+3]!<8)transparent++;
    }
    return {red,opaque,transparent,width:canvas.width,height:canvas.height};
  },Array.from(png));
}
async function saveEvidence(info:TestInfo,name:string,value:unknown):Promise<void>{
  const text=JSON.stringify(value,null,2),path=join(evidenceDirectory,name+'.json');
  await writeFile(path,text);await info.attach(name,{body:Buffer.from(text),contentType:'application/json'});
}

test.describe('compiled Linux 3DGS distribution',()=>{
  test.skip(process.platform!=='linux','This case starts the Linux binary; Windows smoke and OBS validation are separate.');
  test.beforeAll(async()=>{
    test.setTimeout(180000);await mkdir(evidenceDirectory,{recursive:true});
    // Rebuild even when a local dist file exists: evidence must match this source.
    const build=await run('bun',['run','build:exe','--linux'],{cwd:resolve('.'),timeout:150000,maxBuffer:4*1024*1024});
    await writeFile(join(evidenceDirectory,'executable-build.log'),build.stdout+build.stderr);
    directory=await mkdtemp(join(tmpdir(),'entaku-gs-executable-'));executable=join(directory,'entaku-overlay');dataDirectory=join(directory,'data');
    await copyFile(resolve('dist/entaku-overlay'),executable);await chmod(executable,0o755);
    expect(await readdir(directory)).toEqual(['entaku-overlay']);
    await mkdir(dataDirectory);expect(await readdir(dataDirectory)).toEqual([]);
    const doctor=await run(executable,['--doctor'],{cwd:directory,env:{...process.env,PATH:''},timeout:15000});
    const report=JSON.parse(doctor.stdout);expect(report.compiled).toBe(true);expect(report.platform).toBe('linux');expect(report.authorization).toBe('not-attempted');
    preflight={doctor:report,binarySha256:createHash('sha256').update(await readFile(executable)).digest('hex'),emptyUserData:true,isolatedExecutableOnly:true,childPath:'',mode:'demo'};
  });
  test.afterAll(async()=>{
    try{await stopServer(server);server=undefined;}
    finally{if(directory)await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  });

  test('cold offline executable restores a saved Gaussian and runs embedded workers/WASM with visible pixels',async({},info)=>{
    test.setTimeout(240000);let boot:ColdBrowser|undefined,cold:ColdBrowser|undefined;
    const result:Record<string,unknown>={preflight,obs:'not-tested',gpu:'Chromium software WebGL; not a real-GPU performance test'};
    try{
      server=await startCompiled();boot=await coldBrowser(server.origin);
      await boot.page.goto('/overlay');const initial=await snapshot(boot.page);
      expect(initial.avatarProfiles).toHaveLength(0);
      expect(await boot.page.evaluate(async()=>(await fetch('/api/gaussian-assets')).json())).toEqual([]);
      const fixture=gaussianFixture(0);
      const asset:StoredGaussianAsset=await boot.page.evaluate(async bytes=>{
        const form=new FormData();form.set('archive',new File([new Uint8Array(bytes)],'offline-fixture.entaku.zip',{type:'application/zip'}));
        const response=await fetch('/api/gaussian-assets/import',{method:'POST',body:form});
        if(!response.ok)throw new Error(await response.text());return response.json();
      },Array.from(fixture.archive));
      const profile={kind:'gaussian',userId:'100',assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0};
      await command(boot.page,{type:'studio-set',scene:{...initial.studio,quality:{...initial.studio.quality,shadows:'off',ao:'off',reflections:false,msaa:0,fxaa:false,gi:'off'},post:{...initial.studio.post,enabled:false}}});
      await command(boot.page,{type:'avatar-set',profile});
      result.imported={assetId:asset.assetId,splats:asset.splatCount,bytes:asset.byteLength};
      result.bootstrapNetwork=structuredClone(boot.network);
      await boot.browser.close();boot=undefined;
      await stopServer(server);result.firstServerLog=server.output();server=undefined;
      const saved=JSON.parse(await readFile(join(dataDirectory,'avatars.json'),'utf8'));
      expect(saved.profiles.find((p:{userId:string})=>p.userId==='100')).toMatchObject(profile);
      result.persistedSchemaVersion=saved.schemaVersion;

      // Restart the copied binary and use a separate cold browser process. No
      // import request is made in this phase: all character bytes come from disk.
      server=await startCompiled();cold=await coldBrowser(server.origin);
      result.browserVersion=cold.browser.version();result.httpCacheDisabled=true;result.serviceWorkers='blocked';result.browserProcess='new after executable restart';
      await cold.page.goto('/overlay');const restored=await snapshot(cold.page);
      expect(restored.avatarProfiles.find(p=>p.userId==='100')).toMatchObject(profile);
      await command(cold.page,{type:'mode',mode:'MANUAL'});await command(cold.page,{type:'single',userId:'100'});
      await expect(cold.page.locator('#scene')).toHaveAttribute('data-gaussian-instances','1',{timeout:90000});
      await expect.poll(async()=>cold!.page.evaluate(()=>{
        const element=document.querySelector<HTMLCanvasElement>('#scene')!;
        return JSON.parse(element.dataset.gaussianStatus??'[]').some((s:{userId:string;phase:string})=>s.userId==='100'&&s.phase==='ready');
      }),{timeout:90000}).toBe(true);
      await expect.poll(async()=>Number(await cold!.page.locator('#scene').getAttribute('data-gaussian-selected-splats')),{timeout:90000}).toBeGreaterThan(0);
      await expect(cold.page.locator('#scene')).toHaveAttribute('data-composition',/^(SINGLE|MODERATOR)_/,{timeout:30000});
      const shown=await cold.page.locator('#scene').screenshot({path:join(evidenceDirectory,'executable-restored.png'),omitBackground:true});
      const shownPixels=await coloredPixels(cold.page,shown);result.shownPixels=shownPixels;
      await info.attach('compiled-gaussian-restored',{body:shown,contentType:'image/png'});
      const runtime=await cold.page.evaluate(()=>(window as unknown as {entakuGaussianDiagnostics:()=>unknown}).entakuGaussianDiagnostics());result.runtime=runtime;
      const embedded=await cold.page.evaluate(()=>{
        const evidence=(window as unknown as {executableGaussianEvidence:{workers:Array<{url:string;messages:number;errors:string[]}>;wasmCompileBytes:number[];wasmErrors:string[]}}).executableGaussianEvidence;
        const canvas=document.querySelector<HTMLCanvasElement>('#scene')!,gl=canvas.getContext('webgl2')!,debug=gl.getExtension('WEBGL_debug_renderer_info');
        return {evidence,origin:location.origin,userAgent:navigator.userAgent,crossOriginIsolated,webgl:gl.getParameter(gl.VERSION),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null};
      });result.embedded=embedded;
      expect(embedded.evidence.wasmCompileBytes.some(n=>n>1000)).toBe(true);expect(embedded.evidence.wasmErrors).toEqual([]);
      expect(embedded.evidence.workers.length).toBeGreaterThan(0);
      expect(embedded.evidence.workers.every(w=>w.url.startsWith('blob:'+server!.origin+'/'))).toBe(true);
      expect(embedded.evidence.workers.some(w=>w.messages>0)).toBe(true);expect(embedded.evidence.workers.flatMap(w=>w.errors)).toEqual([]);
      expect(shownPixels.red).toBeGreaterThan(100);

      // Removing only the Gaussian proves the measured red pixels belonged to
      // its appearance, rather than an unrelated background or placeholder.
      await command(cold.page,{type:'avatar-reset',userId:'100'});
      await expect(cold.page.locator('#scene')).toHaveAttribute('data-gaussian-instances','0');
      const removed=await cold.page.locator('#scene').screenshot({path:join(evidenceDirectory,'executable-avatar-removed.png'),omitBackground:true});
      const removedPixels=await coloredPixels(cold.page,removed);result.removedPixels=removedPixels;
      expect(shownPixels.red-removedPixels.red).toBeGreaterThan(100);
      const localAssets=cold.network.requests.filter(r=>new URL(r.url).pathname.startsWith(`/api/gaussian-assets/${asset.assetId}/file`));
      expect(localAssets.some(r=>new URL(r.url).searchParams.get('path')===asset.manifest.splat)).toBe(true);
      expect(localAssets.some(r=>new URL(r.url).searchParams.get('path')===asset.manifest.proxy)).toBe(true);
      expect(cold.network.requests.some(r=>new URL(r.url).pathname==='/api/gaussian-assets/import')).toBe(false);
      expect(cold.network.blocked).toEqual([]);expect(cold.network.failed).toEqual([]);expect(cold.network.httpErrors).toEqual([]);
      expect(cold.network.pageErrors).toEqual([]);expect(cold.network.consoleErrors).toEqual([]);
      result.result='passed';
    }finally{
      if(boot){result.bootstrapNetwork=structuredClone(boot.network);await boot.browser.close();}
      if(cold){result.coldNetwork=structuredClone(cold.network);await cold.browser.close();}
      if(server){await stopServer(server);result.lastServerLog=server.output();server=undefined;}
      await saveEvidence(info,'executable-offline-results',result);
    }
  });
});
