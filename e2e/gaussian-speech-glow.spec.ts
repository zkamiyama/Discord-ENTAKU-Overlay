import {expect,test,type Page} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
let probe='';
test.beforeAll(()=>{mkdirSync('.work/gaussian',{recursive:true});execFileSync('bun',['build','tests/helpers/gaussian-speech-probe.ts','--target=browser','--outfile=.work/gaussian/speech-probe.js']);probe=readFileSync('.work/gaussian/speech-probe.js','utf8');});
async function setup(page:Page){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());if(m.text().startsWith('ENTAKU_SPEECH_SETTLE_'))console.info(m.text());});
 await page.route('**/gaussian-speech-probe',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas><script type="module" src="/static/gaussian-speech-probe.js"></script>'}));
 await page.route('**/static/gaussian-speech-probe.js',r=>r.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/gaussian-speech-probe');await page.waitForFunction(()=>!!(window as any).gaussianSpeechProbe,{},{timeout:90000});return errors;
}
test('production Fresnel and halo follow speech, scale, world occlusion and stop without residual color',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  await p.settle({speaking:'none'});const offState=p.save('off');
  await p.settle({mode:1});p.save('rim');
  await p.settle({mode:2,glowScale:4});p.save('halo');
  const rim=p.compare('off','rim'),halo=p.compare('rim','halo');
  await p.settle({mode:2,glowScale:1});p.save('thin');
  await p.settle({mode:2,glowScale:8});p.save('wide');const width=p.compare('thin','wide');
  await p.settle({speaking:'none'});const stoppedState=p.save('stopped');const stopped=p.compare('off','stopped');
  await p.settle({layout:'hidden',speaking:'none'});p.save('hiddenOff');
  await p.settle({layout:'hidden'});p.save('hiddenOn');const hidden=p.compare('hiddenOff','hiddenOn');
  const final=await p.settle({layout:'blocker'});
  return {rim,halo,width,stopped,hidden,offState,stoppedState,final};
 });
 writeFileSync('.work/gaussian/speech-occlusion-results.json',JSON.stringify(result,null,2));
 await page.locator('canvas').screenshot({path:'.work/gaussian/speech-blocker.png',omitBackground:true});
 expect(result.rim.changed).toBeGreaterThan(500);expect(result.rim.green).toBeGreaterThan(5000);
 expect(result.halo.changed).toBeGreaterThan(100);expect(result.width.changed).toBeGreaterThan(100);
 expect(result.stopped.max).toBeLessThanOrEqual(3);expect(result.hidden.max).toBeLessThanOrEqual(3);
 for(const draw of result.final.draws)expect(draw.ranges).toEqual(draw.expected);
 expect(errors).toEqual([]);
});
test('shared-data speakers stay independent across opposite split views, CUT, resize, LoD and post effects',async({page})=>{
 test.setTimeout(300000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  await p.settle({layout:'overlap',speaking:'none'});p.save('off');
  const rear=await p.settle({layout:'overlap',speaking:'first'});p.save('rear');
  const front=await p.settle({layout:'overlap',speaking:'second'});p.save('front');
  const independent=p.compare('rear','front');
  const states=[];
  for(const swap of [false,true,false])states.push(await p.settle({layout:'overlap',speaking:'first',split:true,swap,width:640,height:360,budget:8000}));
  states.push(await p.settle({layout:'overlap',speaking:'second',split:true,swap:true,width:801,height:450,budget:4000}));
  const effects=await p.settle({layout:'overlap',speaking:'first',quality:{msaa:4,fxaa:true,reflections:true,ao:'gtao'},post:{enabled:true,excludeAvatars:false,dof:true,bloom:true}});
  return {rear,front,independent,states,effects};
 });
 writeFileSync('.work/gaussian/speech-split-results.json',JSON.stringify(result,null,2));
 await page.locator('canvas').screenshot({path:'.work/gaussian/speech-effects.png',omitBackground:true});
 expect(result.independent.changed).toBeGreaterThan(500);
 for(const state of [result.rear,result.front,...result.states,result.effects]){
  expect(state.draws.length).toBeGreaterThan(0);
  for(const draw of state.draws){expect(draw.ranges).toEqual(draw.expected);expect(draw.ranges.filter((r:number[])=>r[2]!>0)).toHaveLength(1);}
 }
 for(const [index,state] of result.states.entries()){
  expect(new Set(state.draws.map((d:any)=>d.camera)).size).toBe(2);expect(state.runtime.views.length).toBeLessThanOrEqual(3);
  const active=state.runtime.views.filter((view:any)=>view.active);expect(active).toHaveLength(2);
  const sign=index===1||index===3?-1:1;
  expect(active[0]!.cameraPosition[2]).toBeCloseTo(sign*3.9,6);
  expect(active[1]!.cameraPosition[2]).toBeCloseTo(-sign*3.9,6);
  for(const [panel,view] of active.entries()){
   expect(view.ready).toBe(true);
   expect(view.selectedSplats).toBeLessThanOrEqual(view.budget);
   expect(view.width).toBe(panel===0?Math.floor(state.width/2):state.width-Math.floor(state.width/2));
   expect(view.height).toBe(state.height);
  }
 }
 // Every real draw of each newly created split view starts within its budget,
 // including all preparation frames before the settled snapshot is returned.
 expect(result.states[0]!.drawLimits).toHaveLength(2);
 for(const draw of result.states[0]!.drawLimits){expect(draw.draws).toBeGreaterThan(0);expect(draw.maximumSplats).toBeLessThanOrEqual(4000);expect(draw.maximumExcess).toBe(0);}
 expect(result.states.at(-1)!.runtime.totalBudget).toBe(4000);expect(errors).toEqual([]);
});

test('isotropic near-planar PLY geometry receives an exterior silhouette halo, not only a ring',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const speaking=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  await p.settle({layout:'planar',speaking:'none'});p.save('planarOff');
  const state=await p.settle({layout:'planar',speaking:'first',mode:2,glowScale:4});p.save('planarOn');
  return state;
 });
 await page.locator('canvas').screenshot({path:'.work/gaussian/speech-planar-on.png',omitBackground:true});
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  const outside=p.haloOutside('planarOff','planarOn'),appearance=p.compare('planarOff','planarOn');
  await p.settle({layout:'planar',speaking:'none'});p.save('planarStopped');
  const stopped=p.compare('planarOff','planarStopped');
  return {outside,appearance,stopped};
 }).then(data=>({...data,speaking}));
 writeFileSync('.work/gaussian/speech-planar-results.json',JSON.stringify(result,null,2));
 expect(result.outside.count).toBeGreaterThan(60);
 expect(result.outside.green).toBeGreaterThan(3000);
 expect(result.appearance.changed).toBeGreaterThan(500);
 expect(result.stopped.max).toBeLessThanOrEqual(3);
 for(const draw of result.speaking.draws)expect(draw.ranges.filter((r:number[])=>r[2]!>0)).toHaveLength(1);
 expect(errors).toEqual([]);
});

test('speaker backdrop preserves scene background, world ordering and silent recovery',async({page})=>{
 const errors=await setup(page);
 const r=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  await p.settle({layout:'planar',background:true,speaking:'none'});p.save('bgOff');
  await p.settle({layout:'planar',background:true,speaking:'first'});p.save('bgOn');
  const active=p.compare('bgOff','bgOn'),backgroundOff=p.savedPixel('bgOff',10,10),backgroundOn=p.savedPixel('bgOn',10,10);
  await p.settle({layout:'planar',background:true,speaking:'none'});p.save('bgStop');
  return {active,backgroundOff,backgroundOn,stopped:p.compare('bgOff','bgStop')};
 });
 expect(r.active.changed).toBeGreaterThan(100);
 expect(r.backgroundOff.slice(0,3)).toEqual(r.backgroundOn.slice(0,3));
 expect(r.backgroundOff[0]).toBeGreaterThan(0);
 expect(r.stopped.max).toBeLessThanOrEqual(3);
 expect(errors).toEqual([]);
});

test('screen-space halo responds to projected body size, target pixels and glow setting',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  const radius=(state:any)=>{
    const values=state.draws.flatMap((d:any)=>d.ranges.filter((r:number[])=>r[2]!>0).map((r:number[])=>r[3]!));
    return Math.max(...values);
  };
  const base={layout:'planar',width:600,height:600,cameraDistance:5};
  await p.settle({...base,speaking:'none'});p.save('screenOff');
  const thin=await p.settle({...base,glowScale:1});p.save('screenThin');
  const thinExterior=p.haloOutside('screenOff','screenThin');
  const wide=await p.settle({...base,glowScale:8});p.save('screenWide');
  const wideExterior=p.haloOutside('screenOff','screenWide');
  const near=await p.settle({...base,cameraDistance:2.7,glowScale:4});
  const far=await p.settle({...base,cameraDistance:7,glowScale:4});
  const half=await p.settle({...base,cameraDistance:7,height:300,glowScale:4});
  return {thin:radius(thin),wide:radius(wide),near:radius(near),far:radius(far),half:radius(half),thinExterior,wideExterior};
 });
 writeFileSync('.work/gaussian/speech-screen-space-results.json',JSON.stringify(result,null,2));
 expect(result.wide).toBeCloseTo(result.thin*8,3);
 expect(result.near).toBeGreaterThan(result.far*1.6);
 expect(result.half).toBeCloseTo(result.far*.5,1);
 expect(result.wideExterior.count).toBeGreaterThan(result.thinExterior.count*1.4);
 expect(result.wideExterior.green).toBeGreaterThan(result.thinExterior.green);
 expect(errors).toEqual([]);
});

test('separated simultaneous speakers retain independent halo radius and strength',async({page})=>{
 test.setTimeout(240000);const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe;
  const base={layout:'apart',width:600,height:480,cameraDistance:6,glowScale:1,secondaryStrength:.35};
  await p.settle({...base,speaking:'first'});p.save('firstOnly');
  const wide=await p.settle({...base,speaking:'both',secondaryGlowScale:8});p.save('bothWide');
  const thin=await p.settle({...base,speaking:'both',secondaryGlowScale:1});p.save('bothThin');
  return {
   firstUnchanged:p.compareColumns('firstOnly','bothWide',0,300),
   firstScaleUnchanged:p.compareColumns('bothThin','bothWide',0,300),
   secondActivated:p.compareColumns('firstOnly','bothWide',300,600),
   secondScale:p.compareColumns('bothThin','bothWide',300,600),wide,thin,
  };
 });
 writeFileSync('.work/gaussian/speech-independent-results.json',JSON.stringify(result,null,2));
 expect(result.firstUnchanged.max).toBeLessThanOrEqual(3);
 expect(result.firstScaleUnchanged.max).toBeLessThanOrEqual(3);
 expect(result.secondActivated.changed).toBeGreaterThan(100);
 expect(result.secondScale.changed).toBeGreaterThan(100);
 for(const state of [result.wide,result.thin])for(const draw of state.draws){
  expect(draw.ranges).toEqual(draw.expected);
  expect(draw.ranges.filter((range:number[])=>range[2]!>0).map((range:number[])=>range[2]).sort()).toEqual([.35,1]);
 }
 expect(errors).toEqual([]);
});

test('initial camera micro motion reaches a visible stable native selection',async({page})=>{
 const errors=await setup(page);
 const result=await page.evaluate(async()=>{
  const p=(window as any).gaussianSpeechProbe,options={layout:'planar',startupMotion:true};
  const first=await p.settle(options);
  // A nearby native selection is valid while a fresher selection is pending.
  // Verify idle pixels after that progressive work actually finishes.
  await p.idle();p.save('initialMotion');
  // Keep the camera stationary; a second settle() would reset its pose and
  // repeat the motion, testing a different history rather than idle stability.
  const steady=await p.redraw();p.save('steadyMotion');
  return {first,steady,difference:p.compare('initialMotion','steadyMotion')};
 });
 for(const state of [result.first,result.steady]){
  const view=state.runtime.views.find((view:any)=>view.active);
  expect(view.ready).toBe(true);expect(view.lodMatchesView).toBe(true);expect(view.cameraPosition[0]).toBeCloseTo(.6505,6);
  expect(state.draws.length).toBeGreaterThan(0);expect(view.selectedSplats).toBeGreaterThan(0);
 }
 expect(result.difference.max).toBeLessThanOrEqual(3);expect(errors).toEqual([]);
});
