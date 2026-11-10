import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('.work/fresnel-preview');await mkdir(root,{recursive:true});
const server=createServer(async(req,res)=>{try{if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}const path=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','main.js'].includes(path)){res.writeHead(404).end();return;}res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(join(root,path)));}catch(e){res.writeHead(500).end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
let browser;
try{
browser=await chromium.launch({executablePath:process.env.ENTAKU_CHROMIUM_PATH??chromium.executablePath(),headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:900,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR',String(e));});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('GL_ERROR',m.text().slice(0,5000));}else if(m.text().includes('READY'))console.log(m.text());});
 await page.goto(`http://127.0.0.1:${port}`);await page.waitForFunction(()=>window.fresnelPreview,{timeout:90000});
 const images={},stats={renderer:await page.evaluate(()=>window.fresnelPreview.renderer),errors};
 for(const layout of ['single','overlap','blocker','hidden']){
  for(const mode of [0,1,2]){
   const result=await page.evaluate(async({mode,layout})=>window.fresnelPreview.capture(mode,layout),{mode,layout});
   const name=`${layout}-${mode}`;images[name]=result.image;await writeFile(join(root,name+'.png'),Buffer.from(result.image.split(',')[1],'base64'));
   const {image,...metadata}=result;stats[name]=metadata;console.log(name,metadata.splats,metadata.active);
  }
 }
 const compare=async(a,b)=>page.evaluate(async({a,b})=>{
  async function read(url){const i=new Image();i.src=url;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}
  const p=await read(a),q=await read(b);let changed=0,max=0,green=0,total=0;
  for(let i=0;i<p.length;i+=4){const diff=Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]));if(diff>3)changed++;max=Math.max(max,diff);green+=q[i+1]-p[i+1];total+=diff;}
  return {changed,max,green,mean:total/(p.length/4)};
 },{a,b});
 stats.tests={singleRim:await compare(images['single-0'],images['single-1']),singleHalo:await compare(images['single-1'],images['single-2']),hidden:await compare(images['hidden-0'],images['hidden-2'])};
 console.log('METRICS',JSON.stringify(stats.tests));
 const shot=async(names,title,file)=>{
  const labels=['OFF','FRESNEL','FRESNEL + SOFT HALO'];
  await page.setViewportSize({width:1800,height:750});
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;background:#10151e;color:#e4eaf2;font:18px Arial}header{height:64px;display:flex;align-items:center;padding:0 28px;justify-content:space-between}header b{font-size:23px}header span{color:#95a7bc;font-size:15px}main{display:flex}section{width:600px;border-right:1px solid #33404f}h2{font-size:18px;margin:0;padding:12px 22px;height:46px;letter-spacing:1px}img{display:block;width:600px;height:600px}footer{color:#95a7bc;font-size:13px;padding:6px 24px}</style><header><b>${title}</b><span>Spark 2.4.0 / Three r187 · actual WebGL render</span></header><main>${names.map((n,i)=>`<section><h2>${labels[i]}</h2><img src="${images[n]}"></section>`).join('')}</main><footer>Procedural Gaussian bust, not a trained scan · fixed camera / fixed splats · view-dependent minimum-axis normals · SwiftShader</footer>`);
  await page.locator('img').last().evaluate(i=>i.decode());await page.screenshot({path:join(root,file)});
 };
 await shot(['single-0','single-1','single-2'],'3DGS / SPEAKING RIM-LIGHT STUDY','comparison.png');
 await shot(['overlap-0','overlap-1','overlap-2'],'OVERLAP / rear-left speaks; front-right is silent','overlap-comparison.png');
 await shot(['blocker-0','blocker-1','blocker-2'],'OCCLUSION / an opaque foreground object','occlusion-comparison.png');
 await writeFile(join(root,'results.json'),JSON.stringify(stats,null,2));
 if(errors.length)throw new Error('BROWSER_ERRORS '+errors.length);
 if(stats.tests.singleRim.changed<500)throw new Error('NO_VISIBLE_RIM');
 if(stats.tests.singleHalo.changed<200)throw new Error('NO_VISIBLE_HALO');
 if(stats.tests.hidden.max>3)throw new Error('HIDDEN_EMITTER_LEAKS');
 console.log('CAPTURE_AND_SMOKE_PASS',root);
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
