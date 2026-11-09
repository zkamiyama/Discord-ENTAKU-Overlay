import {test,expect} from './fixtures.ts';
import {personAction} from './controls.ts';
async function state(page:any):Promise<any>{return page.evaluate(()=>new Promise(resolve=>{const w=new WebSocket('ws://'+location.host+'/ws');w.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='snapshot'){w.close();resolve(m.state);}};}));}
test('RC15 defaults, aligned pickers and all checkbox rows fit a dense Dock and preserve timings',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 await expect(page.locator('#quality-nameplates')).toHaveValue('blue');await expect(page.locator('#camera-split')).toBeChecked();await expect(page.locator('#post-saturation')).toHaveValue('1.2');await expect(page.locator('#post-contrast')).toHaveValue('1.1');await expect(page.locator('#exposure-ev')).toHaveValue('0.5');
 for(const id of ['quality-ao','quality-reflections','quality-fxaa'])await expect(page.locator('#'+id)).toBeChecked();await expect(page.locator('#quality-shadow-size')).toHaveValue('1024');await expect(page.locator('#quality-shadow-lights')).toHaveValue('8');
 await expect(page.getByText('今回のBlenderモデルとの比較',{exact:true})).toHaveCount(0);await expect(page.locator('#post-natural')).toHaveCount(0);await expect(page.getByText('カメラの判断',{exact:true})).toHaveCount(0);await expect(page.getByText('青地・白文字（写真風）',{exact:true})).toHaveCount(0);
 await page.locator('#camera-settings > summary').click();await page.locator('#camera-onset').fill('2.2');await page.locator('#camera-onset').press('Tab');await expect.poll(async()=>(await state(page)).studio.direction.startGraceSeconds).toBe(2.2);
 await page.locator('#camera-end-confirm').fill('1');await page.locator('#camera-end-confirm').press('Tab');await expect.poll(async()=>(await state(page)).studio.direction.endConfirmSeconds).toBe(1);
 await page.locator('#camera-end-grace').fill('3');await page.locator('#camera-end-grace').press('Tab');await expect.poll(async()=>(await state(page)).studio.direction.endGraceSeconds).toBe(3);
 await page.locator('#camera-lead-window').fill('20');await page.locator('#camera-lead-window').press('Tab');await expect.poll(async()=>(await state(page)).studio.direction.leadershipWindowSeconds).toBe(20);
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#camera-settings > summary').click();await expect(page.locator('#camera-onset')).toHaveValue('2.2');await page.locator('#camera-reset').click();await expect(page.locator('#camera-onset')).toHaveValue('1.5');
 for(const width of [390,1024]){
  await page.setViewportSize({width,height:1000});await page.selectOption('#theme','dark');
  const dimensions=await page.evaluate(()=>{const a=document.getElementById('studio-pick')!.getBoundingClientRect(),b=document.getElementById('studio-folder-pick')!.getBoundingClientRect();const s=document.getElementById('camera-status')!.getBoundingClientRect(),p=document.querySelector('.preset-bar')!.getBoundingClientRect();return {sameRow:Math.abs(a.y-b.y),sameHeight:Math.abs(a.height-b.height),underPreset:s.top-p.bottom,statusHeight:s.height,overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(dimensions).toMatchObject({sameRow:0,sameHeight:0,underPreset:0,overflow:false});expect(dimensions.statusHeight).toBeLessThanOrEqual(28);
  const checkboxes=await page.evaluate(()=>[...document.querySelectorAll<HTMLInputElement>('label>input[type=checkbox]')].map(input=>({display:getComputedStyle(input.parentElement!).display,width:getComputedStyle(input).width,height:getComputedStyle(input).height,margin:getComputedStyle(input).marginTop})));
  expect(checkboxes.length).toBeGreaterThan(8);expect(checkboxes.every(c=>c.display==='flex'&&c.width==='14px'&&c.height==='14px'&&c.margin==='2px')).toBe(true);
  await page.screenshot({path:`.work/rc15-dock-${width}.png`,fullPage:true});
 }
 expect(errors).toEqual([]);
});
test('cohosts face forward and share a central two-shot despite sustained split-eligible speech',async({page,context})=>{
 test.setTimeout(90000);await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 await personAction(page,page.locator('.person').nth(1),'共同司会に追加');await expect(page.locator('.person[data-zone=moderator]')).toHaveCount(2);
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 const people=page.locator('.person');for(const i of [0,1])await people.nth(i).getByRole('button',{name:'発話 ON',exact:true}).click();
 await expect(page.locator('#shot')).toHaveText('TWO_SHOT',{timeout:12000});await page.waitForTimeout(7000);
 await expect(page.locator('#shot')).toHaveText('TWO_SHOT');await expect(overlay.locator('#scene')).toHaveAttribute('data-split-count','1');await expect(overlay.locator('#scene')).toHaveAttribute('data-composition','MODERATOR_TWO');
 const s=await state(page);expect(s.seats.filter((x:any)=>x.zone==='moderator').every((x:any)=>x.baseYawRad===0)).toBe(true);expect(s.camera.to.position[0]).toBeCloseTo(0,8);expect(s.camera.to.target[0]).toBeCloseTo(0,8);
 await overlay.locator('#scene').screenshot({path:'.work/rc15-cohosts.png'});
});
