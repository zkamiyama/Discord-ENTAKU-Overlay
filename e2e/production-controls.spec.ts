import {personAction} from './controls.ts';
import {expect,test} from './fixtures.ts';
import {png} from '../tests/helpers/png.ts';
test('front and independent back images preview, persist and restore without expanding a reduced image layout',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 // Control/persistence coverage uses a bounded software-GPU viewport. The
 // dedicated pixel probes keep their own fixed resolutions and assertions.
 const overlay=await context.newPage();await overlay.setViewportSize({width:640,height:360});
 overlay.on('pageerror',e=>errors.push(e.message));await overlay.goto(await page.locator('#overlay-url').inputValue());
 await expect(overlay.locator('#scene')).toHaveAttribute('data-quality-status','EFFECTS');
 await personAction(page,page.locator('.person').first(),'アバターを調整');
 await page.locator('#avatar-file').setInputFiles({name:'front.png',mimeType:'image/png',buffer:png()});
 await expect(page.locator('#avatar-apply')).toBeEnabled();
 await page.locator('#avatar-editor details').first().locator('summary').click();
 await page.locator('#avatar-back-file').setInputFiles({name:'back.png',mimeType:'image/png',buffer:png(80,128)});
 await expect(page.locator('#avatar-back-preview')).toBeVisible();await expect(page.locator('#avatar-apply')).toBeEnabled();
 await page.locator('#avatar-scale').fill('3');await expect(page.locator('#avatar-apply')).toBeEnabled();await page.locator('#avatar-apply').click();
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');
 await personAction(page,page.locator('.person').first(),'アバターを調整');
 await expect(page.locator('#avatar-apply')).toBeEnabled();await expect(page.locator('#avatar-scale')).toHaveValue('3');
 if(!await page.locator('#avatar-back-preview').isVisible())await page.locator('#avatar-editor details').first().locator('summary').click();await expect(page.locator('#avatar-back-preview')).toBeVisible();
 await page.screenshot({path:'.work/preview-avatar-front-back.png',fullPage:true});
 page.once('dialog',d=>void d.accept());await page.locator('#avatar-reset').click();await expect(page.locator('#avatar-editor')).not.toBeVisible();
 expect(errors).toEqual([]);
});
test('Dock records anonymized speaking metadata and exports diagnostics without capabilities',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 page.once('dialog',d=>void d.accept());await page.locator('#diagnostics-section > summary').click();await page.locator('#record-start').click();await expect(page.locator('#recording-status')).toContainText('記録中');
 const person=page.locator('.person').first();if(await person.getByRole('button',{name:'発話 OFF',exact:true}).count())await person.getByRole('button',{name:'発話 OFF',exact:true}).click();
 await person.getByRole('button',{name:'発話 ON',exact:true}).click();await page.waitForTimeout(1100);await page.locator('#record-stop').click();
 await expect(page.locator('#recording-status')).toContainText('停止');
 const downloadPromise=page.waitForEvent('download');await page.locator('#record-export').click();const download=await downloadPromise;
 const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();
 expect(text).toContain('anonymized-provider-events');expect(text).not.toContain('2'.repeat(64));expect(text).not.toContain(await person.locator('.person-name').innerText());
 await download.saveAs('.work/test-recording.jsonl');
 if(await person.getByRole('button',{name:'発話 OFF',exact:true}).count())await person.getByRole('button',{name:'発話 OFF',exact:true}).click();
});
