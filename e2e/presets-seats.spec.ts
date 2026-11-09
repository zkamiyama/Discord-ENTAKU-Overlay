import {expect,test} from './fixtures.ts';
import {personAction} from './controls.ts';
test('release removes an absent row and move swaps seats without moving other participants',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');const people=page.locator('.person');await expect(people).toHaveCount(6);
 const id=await people.nth(2).getAttribute('data-user-id');await personAction(page,people.nth(2),'退出');page.once('dialog',d=>void d.accept());await personAction(page,people.nth(2),'予約を解放');
 await expect(people).toHaveCount(5);await expect(page.locator(`.person[data-user-id="${id}"]`)).toHaveCount(0);
 const moving=people.nth(1),user=await moving.getAttribute('data-user-id');await moving.getByRole('button',{name:'参加者メニュー',exact:true}).click();await page.getByRole('menuitem',{name:'席移動 ›',exact:true}).click();
 await page.getByRole('menuitem',{name:'右1（空席）',exact:true}).click();const row=page.locator(`.person[data-user-id="${user}"]`);await expect(row).toHaveAttribute('data-slot','2');
 await row.getByRole('button',{name:'参加者メニュー',exact:true}).click();await page.getByRole('menuitem',{name:'席移動 ›',exact:true}).click();await page.getByRole('menuitem',{name:/^司会（.*と入替）$/}).click();await expect(row).toHaveAttribute('data-zone','moderator');
 await page.reload();await expect(row).toHaveAttribute('data-zone','moderator');await expect(people).toHaveCount(5);
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 await personAction(page,people.nth(1),'共同司会に追加');await expect(page.locator('.person[data-zone=moderator]')).toHaveCount(2);
 await page.waitForTimeout(1600);await overlay.screenshot({path:'.work/rc12-cohost-nameplates.png',omitBackground:true});
});
test('preset dropdown replaces title, saves all parameters and restores without a voice reconnect',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 await expect(page.locator('.titlebar')).toHaveCount(0);await expect(page.locator('#preset-select')).toBeVisible();await expect(page.locator('#preset-select optgroup').last()).toContainText('現在の状態を新規プリセットに');
 await page.locator('#camera-settings > summary').click();await page.locator('#camera-fov').fill('19');await page.locator('#camera-fov').press('Tab');await page.locator('#theme').selectOption('dark');
 await page.locator('#preset-select').selectOption('__new__');await expect(page.locator('#preset-dialog')).toBeVisible();await page.locator('#preset-name').fill('夜の討論');await page.locator('#preset-save').click();
 await expect(page.locator('#preset-dialog')).not.toBeVisible();await expect(page.locator('#preset-select')).toHaveValue('夜の討論.json');
 await page.locator('#camera-fov').fill('29');await page.locator('#camera-fov').press('Tab');await page.locator('#theme').selectOption('light');await expect(page.locator('#preset-select')).toHaveValue('');await expect(page.locator('#preset-select option').first()).toContainText('変更中');
 await page.locator('#preset-select').selectOption('__new__');await page.locator('#preset-name').fill('夜の討論');await page.locator('#preset-save').click();await expect(page.locator('#preset-error')).toContainText('同名');await page.locator('#preset-cancel').click();
 await page.locator('#preset-select').selectOption('夜の討論.json');await expect(page.locator('#camera-fov')).toHaveValue('19');await expect(page.locator('#theme')).toHaveValue('dark');await expect(page.locator('#transport')).toHaveText('接続済み');
 await page.reload();await expect(page.locator('#preset-select option[value="夜の討論.json"]')).toHaveCount(1);await page.locator('#camera-settings > summary').click();await expect(page.locator('#camera-fov')).toHaveValue('19');
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.work/rc12-presets-${width}.png`,fullPage:true});}
 expect(errors).toEqual([]);
});
