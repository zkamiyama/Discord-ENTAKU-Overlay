import {expect,test} from './fixtures.ts';
async function state(page:any):Promise<any>{return page.evaluate(()=>new Promise(resolve=>{const w=new WebSocket('ws://'+location.host+'/ws');w.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='snapshot'){w.close();resolve(m.state);}};}));}
test('a two-person composition confirms END for 2.5s before its five-second narrowing grace',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const people=page.locator('.person');await people.nth(1).getByRole('button',{name:'発話 ON',exact:true}).click();await people.nth(2).getByRole('button',{name:'発話 ON',exact:true}).click();
 await expect(page.locator('#shot')).toHaveText('TWO_SHOT',{timeout:12000});
 await people.nth(2).getByRole('button',{name:'発話 OFF',exact:true}).click();
 const start=Date.now();await expect(page.locator('#auto-countdown')).toContainText('終了確認');
 await page.waitForTimeout(1800);await expect(page.locator('#shot')).toHaveText('TWO_SHOT');
 await expect(page.locator('#auto-countdown')).toContainText('切替まで',{timeout:4000});
 await expect(page.locator('#shot')).toHaveText('SINGLE',{timeout:8000});expect(Date.now()-start).toBeGreaterThan(7100);
});
test('default manual countdown survives Dock reload and returns to AUTO after ten seconds',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 await page.locator('.person').nth(1).getByRole('button',{name:'この人を撮る',exact:true}).click();
 await expect(page.locator('#shot')).toHaveText('SINGLE');await expect(page.locator('#auto-countdown')).toContainText('自動復帰');
 const a=await state(page);expect(a.autoResumeAtMs-a.serverNowMs).toBeGreaterThan(8000);expect(a.autoResumeAtMs-a.serverNowMs).toBeLessThanOrEqual(10000);
 await page.reload();await expect(page.locator('#auto-countdown')).toContainText('自動復帰');
 await expect(page.locator('#mode')).toHaveText('AUTO',{timeout:12000});await expect(page.locator('#shot')).toHaveText('SINGLE');
 await page.locator('#auto').click();await expect(page.locator('#mode')).toHaveText('HOLD');await expect(page.locator('#auto-countdown')).toHaveText('手動固定');
 await page.locator('.person').nth(2).getByRole('button',{name:'この人を撮る',exact:true}).click();expect((await state(page)).autoResumeAtMs).toBeNull();
});
test('dense Dock has a range for every number and separate quality, post and studio menus',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 const count=await page.locator('input[type=number]').count();expect(count).toBeGreaterThan(30);await expect(page.locator('.numeric-control input[type=range]')).toHaveCount(count);
 await expect(page.locator('#quality-panel > summary')).toHaveText('画質');await expect(page.locator('#post-panel > summary')).toHaveText('ポストエフェクト');await expect(page.locator('#hold')).toHaveCount(0);await expect(page.locator('#studio-panel #quality-nameplates')).toHaveCount(1);
 await page.locator('#camera-settings > summary').click();const slider=page.locator('#camera-return-slider');await slider.focus();await slider.press('Home');await slider.press('ArrowRight');await slider.press('Tab');
 await expect.poll(async()=>(await state(page)).studio.direction?.manualReturnSeconds).toBe(2);
 await page.locator('#camera-return').fill('15');await page.locator('#camera-return').press('Tab');await expect(slider).toHaveValue('15');
 await page.locator('#quality-panel > summary').click();await page.locator('#quality-msaa').selectOption('2');await expect.poll(async()=>(await state(page)).studio.quality?.msaa).toBe(2);
 await page.locator('#quality-shadow-lights').selectOption('8');await expect.poll(async()=>(await state(page)).studio.quality?.shadowLights).toBe(8);
 await expect(overlay.locator('#scene')).toHaveAttribute('data-quality-status','EFFECTS');await expect(overlay.locator('#scene')).toHaveAttribute('data-msaa-samples',/2|4/);
 for(const width of [390,1024]){
  await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.work/rc8-dock-${width}.png`,fullPage:true});
 }
 await overlay.screenshot({path:'.work/rc8-low-wide.png'});expect(errors).toEqual([]);
});

test('a hesitation cancels end confirmation without extinguishing the camera turn',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const people=page.locator('.person');for(const i of [1,2])await people.nth(i).getByRole('button',{name:'発話 ON',exact:true}).click();
 await expect(page.locator('#shot')).toHaveText('TWO_SHOT',{timeout:12000});
 await people.nth(2).getByRole('button',{name:'発話 OFF',exact:true}).click();
 await expect(people.nth(2)).toHaveAttribute('data-speaking','inactive');
 await expect(page.locator('#auto-countdown')).toContainText('終了確認');
 await page.waitForTimeout(1700);await expect(page.locator('#shot')).toHaveText('TWO_SHOT');
 await people.nth(2).getByRole('button',{name:'発話 ON',exact:true}).click();
 await expect(people.nth(2)).toHaveAttribute('data-speaking','active');
 await expect(page.locator('#auto-countdown')).toHaveText('自動撮影中');
 await page.waitForTimeout(1400);await expect(page.locator('#shot')).toHaveText('TWO_SHOT');
});
