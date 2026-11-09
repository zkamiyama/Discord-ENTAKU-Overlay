import {expect,test,type Page} from './fixtures.ts';
import {openSession} from './controls.ts';
async function snapshot(page:Page){return page.evaluate(()=>new Promise<any>((resolve,reject)=>{const w=new WebSocket('ws://'+location.host+'/ws');const timer=setTimeout(()=>{w.close();reject(new Error('SNAPSHOT_TIMEOUT'));},5000);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='snapshot'){clearTimeout(timer);w.close();resolve(m.state);}};}));}
test('quality switches persist without changing the shot and rear arc is fixed during rendered desk growth',async({page,context})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 // Exercise every real effect and the requested supersampling factor, but do
 // not benchmark a full-HD software GPU in this control/persistence test.
 // Fixed-size pixel regressions and the explicit 1080p benchmark stay separate.
 const overlay=await context.newPage();await overlay.setViewportSize({width:640,height:360});await overlay.goto(await page.locator('#overlay-url').inputValue());overlay.on('console',m=>{if(m.type()==='error'||m.text().includes('QUALITY_EFFECTS_FAILED'))errors.push(m.text());});
 await page.locator('#auto').click();await page.locator('.person').nth(1).getByRole('button',{name:'この人を撮る',exact:true}).click();await expect(page.locator('#shot')).toHaveText('SINGLE');await page.waitForTimeout(1600);
 const old=await snapshot(page);
 await page.locator('#quality-panel > summary').click();await page.locator('#quality-high').click();
 await expect(overlay.locator('#scene')).toHaveAttribute('data-quality-status','EFFECTS',{timeout:20000});
 await expect(page.locator('#quality-ao')).toBeChecked();await expect(page.locator('#quality-reflections')).toBeChecked();
 expect((await snapshot(page)).camera).toEqual(old.camera);
 await page.locator('#table-settings > summary').click();await page.locator('#quality-nameplates').selectOption('blue');await expect.poll(async()=>(await snapshot(page)).studio.quality?.nameplates).toBe('blue');
 await overlay.screenshot({path:'.work/quality-high-nameplate.png',omitBackground:true});
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#quality-panel > summary').click();await expect(page.locator('#quality-nameplates')).toHaveValue('blue');
 await page.locator('#quality-default').click();await page.locator('#table-settings > summary').click();await page.locator('#quality-nameplates').selectOption('white');await expect(overlay.locator('#scene')).toHaveAttribute('data-quality-status','EFFECTS');
 await expect(page.locator('#quality-msaa')).toHaveValue('4');

 await page.locator('#quality-gi').check();await expect.poll(async()=>(await snapshot(page)).studio.quality?.gi).toBe('ssgi');
 await page.locator('#quality-render-scale').selectOption('1.5');
 await expect.poll(async()=>Number(await overlay.locator('#scene').getAttribute('data-render-scale'))).toBe(1.5);
 await expect.poll(()=>overlay.locator('#scene').evaluate((c:HTMLCanvasElement)=>[c.width,c.height])).toEqual([960,540]);
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#quality-panel > summary').click();
 await expect(page.locator('#quality-gi')).toBeChecked();await expect(page.locator('#quality-render-scale')).toHaveValue('1.5');
 await page.locator('#quality-default').click();await expect(page.locator('#quality-gi')).not.toBeChecked();
 const initial=await snapshot(page);const host=initial.seats.find((s:any)=>s.zone==='moderator');
 for(let i=0;i<3;i++)await page.locator('#add').click();
 await expect.poll(async()=>(await snapshot(page)).session.capacity).toBeGreaterThan(initial.session.capacity);
 await page.waitForTimeout(2300);const next=await snapshot(page);const nextHost=next.seats[host.slotIndex];expect(nextHost.position[2]).toBeCloseTo(host.position[2],8);
 expect(next.deskOffsetZ-next.straightLength/2).toBeCloseTo(initial.deskOffsetZ-initial.straightLength/2,8);
 await page.locator('#wide').click();await page.waitForTimeout(400);await overlay.screenshot({path:'.work/host-fixed-expanded.png',omitBackground:true});
 // Exercise reservation cleanup too; each test owns its own demo server.
 for(const p of next.participants.filter((p:any)=>!initial.participants.some((q:any)=>q.userId===p.userId))){
  const state=await snapshot(page);await page.evaluate(async({id,revision})=>fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'demo-presence',userId:id,present:false,requestId:crypto.randomUUID(),expectedRevision:revision})}),{id:p.userId,revision:state.revision});
 }
 await openSession(page);page.once('dialog',d=>void d.accept());await page.locator('#new-session').click();
 expect(errors).toEqual([]);
});
