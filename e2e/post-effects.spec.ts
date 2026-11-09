import {expect,test} from './fixtures.ts';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
let probe='';
test.beforeAll(()=>{execFileSync('bun',['build','tests/helpers/post-probe.ts','--target=browser','--outfile=.work/post-probe.js']);probe=readFileSync('.work/post-probe.js','utf8');});
async function setup(page:any){
 const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('console',(m:any)=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.route('**/post-probe',(r:any)=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><canvas></canvas><script type="module" src="/static/post-probe.js"></script></body></html>'}));
 await page.route('**/static/post-probe.js',(r:any)=>r.fulfill({contentType:'text/javascript',body:probe}));await page.goto('/post-probe');await page.waitForFunction(()=>!!(window as any).postProbe);return errors;
}
test('post grading and threshold bloom protect avatars unless inclusion is selected',async({page})=>{
 const errors=await setup(page);
 const result=await page.evaluate(()=>{const p=(window as any).postProbe;p.render({});const original=p.pixel([-.7,0,0]);p.render({saturation:0,contrast:1.2,bloom:true,bloomStrength:.3,bloomThreshold:.8});const excluded=p.pixel([-.7,0,0]);p.render({excludeAvatars:false,saturation:0});const included=p.pixel([-.7,0,0]);return {original,excluded,included};});
 console.log('post avatar RGB',result);expect(result.excluded).toEqual(result.original);expect(Math.abs(result.included[0]-result.included[1])).toBeLessThan(3);expect(result.included).not.toEqual(result.original);
 const glow=await page.evaluate(()=>{const p=(window as any).postProbe;p.render({bloom:true,bloomStrength:1,bloomThreshold:1.5});const high=p.pixel([1.05,.6,0]);p.render({bloom:true,bloomStrength:1,bloomThreshold:.5});const low=p.pixel([1.05,.6,0]);return {high,low};});
 console.log('bloom threshold',glow);expect(glow.low[0]).toBeGreaterThan(glow.high[0]+3);expect(errors).toEqual([]);
});
test('DoF softens the studio, keeps the focal band sharp and preserves transparent corners',async({page})=>{
 const errors=await setup(page);
 const result=await page.evaluate(()=>{const p=(window as any).postProbe;p.render({});const before={back:p.stripeContrast(),front:p.stripeContrast(true),avatar:p.pixel([-.7,0,0])};p.render({dof:true,aperture:.01,maxBlur:10});const after={back:p.stripeContrast(),front:p.stripeContrast(true),avatar:p.pixel([-.7,0,0]),alpha:p.pixel([12,6,-4])};return {before,after};});
 console.log('DoF contrast',result);expect(result.after.back).toBeLessThan(result.before.back*.75);expect(result.after.front).toBeGreaterThan(result.before.front*.98);expect(result.after.front).toBeLessThanOrEqual(result.before.front*1.02);expect(result.after.avatar).toEqual(result.before.avatar);expect(result.after.alpha[3]).toBe(0);
 await page.locator('canvas').screenshot({path:'.work/rc7-dof.png',omitBackground:true});expect(errors).toEqual([]);
});
test('nameplate short glyphs retain their shape and tabletop is one glossy wood surface',async({page})=>{
 const errors=await setup(page);const result=await page.evaluate(()=>{const p=(window as any).postProbe;return {short:p.name('ハル'),long:p.name('非常に長い名前'.repeat(12)),desk:p.desk()};});
 expect(result.short.scaleX).toBeLessThanOrEqual(1.1);expect(result.short.gap).toBeGreaterThan(0);expect(result.long.glyphs).toHaveLength(84);expect(result.long.scaleX).toBeLessThan(1);expect(result.desk).toMatchObject({tops:1,reflective:true});expect(result.desk.roughness).toBeLessThan(.25);expect(result.desk.coat).toBeGreaterThan(.8);expect(errors).toEqual([]);
});
test('post tab presets, exclusion and focus settings persist without changing the camera',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 await page.locator('#auto').click();await page.locator('.person').nth(1).getByRole('button',{name:'この人を撮る',exact:true}).click();await expect(page.locator('#shot')).toHaveText('SINGLE');await page.waitForTimeout(1600);const before=await overlay.locator('#scene').getAttribute('data-camera-position');
 await page.locator('#post-panel > summary').click();await expect(page.locator('#post-exclude')).toBeChecked();
 await page.locator('#post-bloom').check();await expect(page.locator('#post-bloom')).toBeEnabled();await page.locator('#post-dof').check();await expect(page.locator('#post-bloom')).toBeChecked();await expect(page.locator('#post-dof')).toBeChecked();await expect(overlay.locator('#scene')).toHaveAttribute('data-quality-status','EFFECTS');
 await page.locator('#post-focus-mode').selectOption('manual');await page.locator('#post-focus-distance').fill('7');await page.locator('#post-focus-distance').press('Tab');await expect.poll(async()=>Number(await overlay.locator('#scene').getAttribute('data-focus-distance'))).toBe(7);
 expect(await overlay.locator('#scene').getAttribute('data-camera-position')).toBe(before);await page.locator('#post-exclude').uncheck();await expect(overlay.locator('#scene')).toHaveAttribute('data-exclude-avatars','false');
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#post-panel > summary').click();await expect(page.locator('#post-focus-distance')).toHaveValue('7');await expect(page.locator('#post-exclude')).not.toBeChecked();
 await page.screenshot({path:'.work/rc7-post-tab.png',fullPage:true});await page.locator('#post-reset').click();await expect(page.locator('#post-speech-glow')).toHaveValue('4');
});

test('glossy tabletop SSR cannot introduce black pixels from invalid reflection samples',async({page,context})=>{
 test.setTimeout(90000);
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 await page.locator('#auto').click();await page.locator('.person').nth(1).getByRole('button',{name:'この人を撮る',exact:true}).click();await expect(page.locator('#shot')).toHaveText('SINGLE');await page.waitForTimeout(1800);
 const snapshot=()=>page.evaluate(()=>new Promise<any>(resolve=>{const w=new WebSocket('ws://'+location.host+'/ws');w.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='snapshot'){w.close();resolve(m.state);}};}));
 const exposure=Number(await overlay.locator('#scene').getAttribute('data-exposure'));
 const apply=async(reflections:boolean)=>{const s=await snapshot();await page.evaluate(async({s,exposure,reflections})=>{const r=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'studio-set',requestId:crypto.randomUUID(),expectedRevision:s.revision,scene:{...s.studio,quality:{shadows:'off',msaa:4,reflections},exposure:{mode:'manual',compensationEV:0,manualExposure:exposure,lighting:'auto'}}})});if(!r.ok)throw new Error(await r.text());},{s,exposure,reflections});await page.waitForTimeout(500);};
 await apply(false);const before=(await overlay.locator('#scene').screenshot()).toString('base64');
 await apply(true);const after=(await overlay.locator('#scene').screenshot({path:'.work/rc7-glossy-table.png'})).toString('base64');
 const black=await page.evaluate(async({before,after})=>{const pixels=async(base64:string)=>{const b=await createImageBitmap(new Blob([Uint8Array.from(atob(base64),x=>x.charCodeAt(0))],{type:'image/png'}));const c=document.createElement('canvas');c.width=b.width;c.height=b.height;const x=c.getContext('2d')!;x.drawImage(b,0,0);b.close();return x.getImageData(0,0,c.width,c.height).data;};const a=await pixels(before),b=await pixels(after);let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!+a[i+1]!+a[i+2]!>90&&b[i]!+b[i+1]!+b[i+2]!<9)count++;return count;},{before,after});
 expect(black).toBe(0);
});
