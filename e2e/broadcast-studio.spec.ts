import {expect,test} from './fixtures.ts';
import {personAction,openSession} from './controls.ts';
test('compact Dock supports themes, keyboard menus and one/two moderator layouts',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const overlay=await context.newPage();await overlay.setViewportSize({width:640,height:360});await overlay.goto(await page.locator('#overlay-url').inputValue());
 await expect(overlay.locator('#scene')).toHaveAttribute('data-studio-status','READY');
 await expect(page.locator('.person[data-zone=moderator]')).toHaveCount(1);
 await expect(page.locator('.person[data-zone=front]')).toHaveCount(1);
 await personAction(page,page.locator('.person').nth(5),'退出');
 await openSession(page);page.once('dialog',d=>void d.accept());await page.locator('#new-session').click();
 await expect(page.locator('#counts')).toHaveText('5人 / 5席');
 await expect(page.locator('.person[data-zone=left]')).toHaveCount(2);await expect(page.locator('.person[data-zone=right]')).toHaveCount(2);
 await expect(page.locator('.person[data-zone=front]')).toHaveCount(0);
 await expect.poll(async()=>Number(await overlay.locator('#scene').getAttribute('data-straight-length'))).toBeGreaterThan(2);
 await personAction(page,page.locator('.person').nth(1),'共同司会に追加');
 await expect(page.locator('.person[data-zone=moderator]')).toHaveCount(2);await expect(page.locator('.person[data-zone=front]')).toHaveCount(1);
 await page.reload();await expect(page.locator('.person[data-zone=moderator]')).toHaveCount(2);
 await personAction(page,page.locator('.person').first(),'司会に指定');
 // Resetting reservations now removes the departed row; add a fresh demo participant.
 await expect(page.locator('.person')).toHaveCount(5);await page.locator('#add').click();await expect(page.locator('.person')).toHaveCount(6);
 await openSession(page);page.once('dialog',d=>void d.accept());await page.locator('#new-session').click();await expect(page.locator('#counts')).toHaveText('6人 / 6席');
 const trigger=page.locator('.person').first().getByRole('button',{name:'参加者メニュー',exact:true});await trigger.click();
 await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'司会に指定',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 // The rendered seat assertions are complete. Do not keep a software GPU
 // busy while this test captures six purely-DOM theme/layout screenshots.
 await overlay.close();await page.bringToFront();
 for(const width of [390,1024,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.selectOption('#theme',theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.work/dock-${width}-${theme}.png`,fullPage:true});
 }
 expect(errors).toEqual([]);
});
test('OTS uses a real opposite foreground and the rendered camera moves into a pair',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 // Isolate single-camera MOVE; the default split mode has separate coverage.
 await page.locator('#camera-settings > summary').click();await page.locator('#camera-split').uncheck();
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 const people=page.locator('.person');await people.nth(1).getByRole('button',{name:'発話 ON',exact:true}).click();
 await expect(page.locator('#composition')).toHaveAttribute('data-composition','SINGLE_OTS',{timeout:8000});
 await expect(page.locator('#foreground')).toContainText('ハル');
 // Wait for the Overlay's rendered state, not just the Dock's server snapshot.
 const rendered=overlay.locator('#scene');
 await expect(rendered).toHaveAttribute('data-composition','SINGLE_OTS');
 const before=await rendered.getAttribute('data-camera-position');
 expect(before).not.toBeNull();
 await overlay.screenshot({path:'.work/broadcast-ots.png'});
 await people.nth(2).getByRole('button',{name:'発話 ON',exact:true}).click();await expect(page.locator('#shot')).toHaveText('TWO_SHOT',{timeout:10000});
 await expect(page.locator('#camera-transition')).toHaveText('MOVE');
 // A software renderer may need more than 400 ms for a frame. Capture the
 // starting pose before the action, then assert that the rendered pose advances.
 // Unit tests separately verify intermediate poses and exact MOVE endpoints.
 await expect(rendered).toHaveAttribute('data-composition','TWO_SHOT');
 await expect(rendered).toHaveAttribute('data-transition','MOVE');
 await expect.poll(()=>rendered.getAttribute('data-camera-position'),{message:'Overlay must render a new camera position for the TWO_SHOT'}).not.toBe(before);
 await people.nth(1).getByRole('button',{name:'発話 OFF',exact:true}).click();await people.nth(2).getByRole('button',{name:'発話 OFF',exact:true}).click();
 await openSession(page);page.once('dialog',d=>void d.accept());await page.locator('#new-session').click();
});
