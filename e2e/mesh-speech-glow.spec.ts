import {expect,test,type Page} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
let source='';
test.beforeAll(()=>{
 mkdirSync('.work/mesh-speech',{recursive:true});
 execFileSync('bun',['build','tests/helpers/mesh-speech-probe.ts','--target=browser','--outfile=.work/mesh-speech/probe.js']);
 source=readFileSync('.work/mesh-speech/probe.js','utf8');
});
async function setup(page:Page){
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/mesh-speech-probe',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas><script type="module" src="/static/mesh-speech-probe.js"></script>'}));
 await page.route('**/static/mesh-speech-probe.js',r=>r.fulfill({contentType:'text/javascript',body:source}));
 await page.goto('/mesh-speech-probe');
 await page.waitForFunction(()=>!!(window as any).meshSpeechProbe,{timeout:60000});
 return errors;
}
test('3D mesh avatar shows a speaking rim with scene occlusion, scale and speech-stop restoration',async({page})=>{
 test.setTimeout(120000);const errors=await setup(page);
 const data=await page.evaluate(async()=>{
  const p=(window as any).meshSpeechProbe;
  await p.settle({strength:0});p.save('off');
  const enabled=await p.settle({strength:1,scale:4});p.save('on');
  const active=p.compare('off','on');
  const scaled=await p.settle({strength:1,scale:8});p.save('wide');
  const width=p.compare('on','wide');
  await p.settle({strength:0});p.save('stop');
  const stopped=p.compare('off','stop');
  await p.settle({strength:0,blocker:true});p.save('blockedOff');
  await p.settle({strength:1,blocker:true});p.save('blockedOn');
  const blocked=p.compare('blockedOff','blockedOn');
  return {enabled,scaled,active,width,stopped,blocked};
 });
 await page.locator('canvas').screenshot({path:'.work/mesh-speech/blocked.png',omitBackground:true});
 writeFileSync('.work/mesh-speech/results.json',JSON.stringify(data,null,2));
 expect(data.enabled.hulls).toBeGreaterThanOrEqual(10);
 expect(data.enabled.error).toBe(0);
 expect(data.active.changed).toBeGreaterThan(100);
 expect(data.active.green).toBeGreaterThan(1000);
 expect(data.width.changed).toBeGreaterThan(50);
 expect(data.stopped.max).toBeLessThanOrEqual(2);
 expect(data.blocked.changed).toBeGreaterThan(50);
 expect(errors).toEqual([]);
});
test('3D mesh avatar glow follows SPLIT render resolution, cameras and post quality',async({page})=>{
 test.setTimeout(120000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).meshSpeechProbe;
  const a=await p.settle({split:true,width:640,height:360,strength:1,scale:4});
  const b=await p.settle({split:true,width:1000,height:540,distance:2.5,strength:1,scale:8});
  const c=await p.settle({width:800,height:450,strength:1,scale:4,post:true});
  await p.settle({split:true,strength:0});p.save('splitOff');
  await p.settle({split:true,strength:1});p.save('splitOn');
  return {a,b,c,changed:p.compare('splitOff','splitOn')};
 });
 expect(result.changed.changed).toBeGreaterThan(50);
 for(const status of [result.a,result.b,result.c])expect(status.error).toBe(0);
 expect(errors).toEqual([]);
});
