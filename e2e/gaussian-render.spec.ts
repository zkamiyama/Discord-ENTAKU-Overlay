import {expect,test,type Page} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
let probe='';
test.beforeAll(()=>{mkdirSync('.work/gaussian',{recursive:true});execFileSync('bun',['build','tests/helpers/gaussian-render-probe.ts','--target=browser','--outfile=.work/gaussian/render-probe.js']);probe=readFileSync('.work/gaussian/render-probe.js','utf8');});
async function setup(page:Page){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'||message.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(message.text());});
 await page.route('**/gaussian-render-probe',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas></canvas><script type="module" src="/static/gaussian-render-probe.js"></script></body></html>'}));
 await page.route('**/static/gaussian-render-probe.js',route=>route.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/gaussian-render-probe');await page.waitForFunction(()=>!!(window as any).gaussianRenderProbe,{},{timeout:90000});return errors;
}
test('Spark appearance reaches official SSR; proxies do not erase main-view color',async({page})=>{
 test.setTimeout(180000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianRenderProbe;
  await p.settle({color:'red',quality:{reflections:false}});const red=p.save('red');
  const directColor=p.sample();await p.settle({color:'red',offscreen:true});const targetColor=p.sample(),targetStats=p.stats();
  await p.settle({color:'red',proxy:false,quality:{reflections:false}});const withoutProxy=p.save('withoutProxy'),selfOcclusion=p.compare('red','withoutProxy');
  await p.settle({color:'red',quality:{reflections:true}});const reflectedRed=p.save('reflectedRed'),reflection=p.compare('red','reflectedRed','floor');
  await p.settle({color:'blue',quality:{reflections:false}});p.save('blueOff');
  await p.settle({color:'blue',quality:{reflections:true}});const reflectedBlue=p.save('reflectedBlue'),changedAppearance=p.compare('reflectedRed','reflectedBlue','floor');
  const reflectionAppearance=p.reflectionAppearance('red','reflectedRed','blueOff','reflectedBlue');
  return {red,directColor,targetColor,targetStats,withoutProxy,selfOcclusion,reflectedRed,reflectedBlue,reflection,changedAppearance,reflectionAppearance,status:p.status()};
 });
 console.log('3DGS reflection pixels',result);writeFileSync('.work/gaussian/reflection-results.json',JSON.stringify(result,null,2));
 await page.locator('canvas').screenshot({path:'.work/gaussian/reflection-blue.png',omitBackground:true});
 expect(result.red.red).toBeGreaterThan(1000);expect(result.selfOcclusion.changed).toBeLessThan(10);
 for(let c=0;c<4;c++)expect(Math.abs(result.directColor[c]-result.targetColor[c])).toBeLessThanOrEqual(3);
 expect(result.targetStats.transparent).toBeGreaterThan(1000);
 expect(result.reflection.changed).toBeGreaterThan(50);expect(result.changedAppearance.changed).toBeGreaterThan(50);
 expect(result.reflectionAppearance.changed).toBeGreaterThan(50);expect(result.reflectionAppearance.redGain).toBeGreaterThan(500);expect(result.reflectionAppearance.blueGain).toBeGreaterThan(500);
 expect(result.changedAppearance.blueChange).toBeGreaterThan(500);expect(result.changedAppearance.redChange).toBeLessThan(-500);expect(errors).toEqual([]);
});
test('world occlusion and proxy shadows follow moves and removal',async({page})=>{
 test.setTimeout(180000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianRenderProbe;
  await p.settle({});const plain=p.save('plain');
  await p.settle({blocker:true});const occluded=p.save('occluded');
  await p.settle({blocker:true,proxy:false});p.save('occludedNoProxy');const selfOcclusion=p.compare('occluded','occludedNoProxy');
  await p.settle({quality:{shadows:'soft'}});p.save('shadow');const shadow=p.compare('plain','shadow','floor');
  await p.settle({quality:{shadows:'soft'},proxy:false});p.save('removed');const removed=p.compare('plain','removed','floor');
  await p.settle({quality:{shadows:'soft'},avatarX:1});p.save('moved');const moved=p.compare('shadow','moved','floor');
  return {plain,occluded,selfOcclusion,shadow,removed,moved,status:p.status()};
 });
 console.log('3DGS geometry pixels',result);writeFileSync('.work/gaussian/geometry-results.json',JSON.stringify(result,null,2));
 await page.locator('canvas').screenshot({path:'.work/gaussian/shadow-moved.png',omitBackground:true});
 expect(result.occluded.red).toBeLessThan(result.plain.red*.8);expect(result.selfOcclusion.changed).toBeLessThan(10);
 expect(result.shadow.darker).toBeGreaterThan(50);expect(result.removed.changed).toBeLessThan(20);expect(result.moved.changed).toBeGreaterThan(50);expect(errors).toEqual([]);
});
test('opposite split cameras keep independent color ordering through CUTs, resize and effects',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianRenderProbe;
  await p.settle({split:true,rear:true},36);const first=p.status();
  await p.settle({rear:true,quality:{reflections:true,ao:'gtao',msaa:4,fxaa:true},post:{enabled:true,excludeAvatars:false,dof:true,bloom:true,aperture:.005,maxBlur:4}});const included=p.status();
  await p.settle({split:true,rear:true,width:800,height:450,quality:{msaa:4}},32);const resized=p.status();
  await p.settle({split:true,rear:true},24);const returned=p.status();
  return {first,included,resized,returned};
 });
 console.log('3DGS multi-view pixels',result);writeFileSync('.work/gaussian/split-results.json',JSON.stringify(result,null,2));
 await page.locator('canvas').screenshot({path:'.work/gaussian/split-opposite.png',omitBackground:true});
 for(const state of [result.first,result.resized,result.returned]){
  expect(state.stats.leftRed).toBeGreaterThan(500);expect(state.stats.rightBlue).toBeGreaterThan(500);
  expect(state.stats.leftRed).toBeGreaterThan(state.stats.leftBlue*2);expect(state.stats.rightBlue).toBeGreaterThan(state.stats.rightRed*2);
  expect(state.stats.transparent).toBeGreaterThan(1000);expect(state.runtime.views.length).toBeLessThanOrEqual(3);
 }
 expect(result.included.quality).toBe('EFFECTS');expect(result.included.stats.red).toBeGreaterThan(100);
 expect(result.returned.memory.textures).toBeLessThanOrEqual(result.resized.memory.textures+3);expect(errors).toEqual([]);
});
test('LoD selection responds to distance and one shared budget for both split views',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianRenderProbe;
  const near=await p.settle({dense:true,distance:2,lodBudget:12000},36);
  const limited=await p.settle({dense:true,distance:2,lodBudget:1000},36);
  const far=await p.settle({dense:true,distance:40,lodBudget:12000},36);
  const split=await p.settle({dense:true,rear:true,split:true,distance:2,lodBudget:2000},40);
  return {near,limited,far,split};
 });
 console.log('3DGS LoD selection (software WebGL)',result);writeFileSync('.work/gaussian/lod-results.json',JSON.stringify(result,null,2));
 const selected=(state:any)=>state.activeViews.reduce((n:number,view:any)=>n+view.selectedSplats,0);
 expect(result.near.source.inputSplats).toBeGreaterThan(3000);expect(result.near.source.originalCpuBytes).toBeGreaterThan(0);expect(result.near.source.lodCpuBytes).toBeGreaterThan(0);
 expect(selected(result.near)).toBeGreaterThan(1500);expect(selected(result.limited)).toBeGreaterThan(0);expect(selected(result.limited)).toBeLessThan(selected(result.near)*.75);
 expect(selected(result.far)).toBeGreaterThan(0);expect(selected(result.far)).toBeLessThan(selected(result.near)*.5);
 expect(result.limited.source).toEqual(result.near.source);expect(result.far.source).toEqual(result.near.source);
 expect(result.split.activeViews).toHaveLength(2);expect(result.split.runtime.totalBudget).toBe(2000);
 expect(result.split.activeViews.reduce((n:number,view:any)=>n+view.budget,0)).toBe(2000);
 // Spark's tree traversal target can round at node boundaries; both views must
 // still stay close to the total, rather than each receiving all 2,000 splats.
 expect(selected(result.split)).toBeGreaterThan(0);expect(selected(result.split)).toBeLessThan(3000);expect(errors).toEqual([]);
});
