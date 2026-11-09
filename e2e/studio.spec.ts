import {openSession} from './controls.ts';
import {personAction} from './controls.ts';
import { expect, test } from './fixtures.ts';
import { mkdir } from 'node:fs/promises';
test('Dock drives overlay, detects speech, reserves seats and restores a returning guest', async ({ page, context }) => {
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/dock');
  await expect(page.locator('#transport')).toHaveText('接続済み');
  await expect(page.locator('.person')).toHaveCount(6);
  const overlayUrl=await page.locator('#overlay-url').inputValue();
  expect(overlayUrl).toBe('http://127.0.0.1:31339/overlay');
  const overlay=await context.newPage();overlay.on('pageerror',error=>errors.push(error.message));
  overlay.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  await overlay.goto(overlayUrl);
  await overlay.waitForFunction(()=>{const c=document.querySelector('canvas');return !!c&&c.width>=1280;});
  await page.waitForTimeout(2000);
  await mkdir('.work',{recursive:true});
  await overlay.screenshot({path:'.work/preview-overlay.png',omitBackground:true});
  const first=page.locator('.person').first();
  const initialSeat=await first.getAttribute('data-slot');
  await first.getByRole('button',{name:'発話 ON',exact:true}).click();
  await expect(page.locator('#shot')).toHaveText('SINGLE',{timeout:7000});
  await overlay.screenshot({path:'.work/preview-speaker.png',omitBackground:true});
  await personAction(page,first,'退出');
  await expect(page.locator('#counts')).toHaveText('5人 / 6席');
  await personAction(page,first,'復帰');
  await expect(page.locator('#counts')).toHaveText('6人 / 6席');
  expect(await first.getAttribute('data-slot')).toBe(initialSeat);
  await page.locator('#auto').click();
  await expect(page.locator('#mode')).toHaveText('HOLD');
  await page.reload();await expect(page.locator('#mode')).toHaveText('HOLD');
  await page.screenshot({path:'.work/preview-dock.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('Dock and Overlay use stable URLs without access keys', async ({ page }) => {
  await page.goto('/dock');
  await expect(page.locator('#transport')).toHaveText('接続済み');
  await expect(page.locator('.person')).toHaveCount(6);
  await expect(page.locator('#overlay-url')).toHaveValue('http://127.0.0.1:31339/overlay');
  expect(new URL(page.url()).hash).toBe('');
});

test('custom image draft calibrates a face, applies an alpha silhouette and resets without a page error', async ({ page, context }) => {
  test.setTimeout(120000); // Default SSR/AO compile on software WebGL as well as the preview.
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/dock');
  await expect(page.locator('#transport')).toHaveText('接続済み');
  const first=page.locator('.person').first();
  const overlay=await context.newPage();
  overlay.on('pageerror',e=>errors.push(e.message));
  overlay.on('console',msg=>{if(msg.type()==='error'||msg.text().includes('CUSTOM_AVATAR_UNAVAILABLE'))errors.push(msg.text());});
  await overlay.goto(await page.locator('#overlay-url').inputValue());
  await personAction(page,first,'画像を調整');
  await expect(page.locator('#avatar-editor')).toBeVisible();
  const { png }=await import('../tests/helpers/png.ts');
  await page.locator('#avatar-file').setInputFiles({name:'synthetic-cutout.png',mimeType:'image/png',buffer:png()});
  await expect(page.locator('#avatar-size')).toContainText('64×128px');
  await expect(page.locator('#avatar-apply')).toBeEnabled();
  await page.locator('#avatar-cancel').click();
  // Selection alone must not apply the asset.
  await personAction(page,first,'画像を調整');
  await expect(page.locator('#avatar-size')).toContainText('PNG / 静止WebP');
  await page.locator('#avatar-file').setInputFiles({name:'synthetic-cutout.png',mimeType:'image/png',buffer:png()});
  await expect(page.locator('#avatar-size')).toContainText('64×128px');
  await page.locator('#avatar-offset-y').fill('0.1');
  await page.locator('#avatar-apply').click();
  await expect(page.locator('#avatar-editor')).not.toBeVisible();
  await first.getByRole('button',{name:'この人を撮る',exact:true}).click();
  await expect(page.locator('#shot')).toHaveText('SINGLE');
  if(await first.getByRole('button',{name:'発話 ON',exact:true}).count())await first.getByRole('button',{name:'発話 ON',exact:true}).click();
  await page.waitForTimeout(1200);
  await overlay.screenshot({path:'.work/preview-custom-avatar.png',omitBackground:true});
  await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');
  await personAction(page,page.locator('.person').first(),'画像を調整');
  await expect(page.locator('#avatar-size')).toContainText('64×128px');
  await expect(page.locator('#avatar-offset-y')).toHaveValue('0.1');
  await page.screenshot({path:'.work/preview-avatar-editor.png',fullPage:true});
  page.once('dialog',d=>void d.accept());await page.locator('#avatar-reset').click();
  await expect(page.locator('#avatar-editor')).not.toBeVisible();
  await expect.poll(()=>errors).toEqual([]);
});

test('narrow Dock accepts a static WebP and pointer selection writes normalized face coordinates', async ({ page }) => {
  await page.setViewportSize({width:360,height:800});
  await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  await personAction(page,page.locator('.person').nth(1),'画像を調整');
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=128;
    const context=canvas.getContext('2d')!;context.fillStyle='#f3ad80';context.fillRect(12,10,40,110);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('WEBP_ENCODING_FAILED')),'image/webp'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.locator('#avatar-file').setInputFiles({name:'static.webp',mimeType:'image/webp',buffer:Buffer.from(bytes)});
  await expect(page.locator('#avatar-size')).toContainText('64×128px');
  const preview=await page.locator('#avatar-preview').boundingBox();expect(preview).not.toBeNull();
  const box=preview!,point=(u:number,v:number)=>({x:box.x+(128+224*u)*box.width/480,y:box.y+(16+448*v)*box.height/480});
  const a=point(.25,.1),b=point(.75,.35);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
  await expect.poll(async()=>Number(await page.locator('#face-x').inputValue())).toBeCloseTo(25,0);
  await expect.poll(async()=>Number(await page.locator('#face-y').inputValue())).toBeCloseTo(10,0);
  await expect.poll(async()=>Number(await page.locator('#face-w').inputValue())).toBeCloseTo(50,0);
  await expect.poll(async()=>Number(await page.locator('#face-h').inputValue())).toBeCloseTo(25,0);
  await expect(page.locator('#avatar-apply')).toBeEnabled();
  await page.locator('#avatar-apply').click();await expect(page.locator('#avatar-editor')).not.toBeVisible();
  await personAction(page,page.locator('.person').nth(1),'画像を調整');
  await expect(page.locator('#avatar-size')).toContainText('64×128px');
  page.once('dialog',d=>void d.accept());await page.locator('#avatar-reset').click();
  await expect(page.locator('#avatar-editor')).not.toBeVisible();
});

test('a nearby second speaker widens SINGLE into TWO_SHOT via MOVE', async ({ page, context }) => {
  await page.goto('/dock');
  await expect(page.locator('#transport')).toHaveText('接続済み');
  await page.locator('#camera-settings > summary').click();await page.locator('#camera-split').uncheck();
  const overlay=await context.newPage();
  await overlay.goto(await page.locator('#overlay-url').inputValue());
  const people=page.locator('.person');
  await expect(people).toHaveCount(6);
  // E2E's local demo server persists between scenarios. Reset earlier speakers
  // and the previous test's HOLD mode before testing an automatic transition.
  for(let i=0;i<6;i++){
    const off=people.nth(i).getByRole('button',{name:'発話 OFF',exact:true});
    if(await off.count())await off.click();
  }
  page.once('dialog',dialog=>void dialog.accept());
  await openSession(page);await page.getByRole('button',{name:'席予約をリセット',exact:true}).click();
  await expect(page.locator('#mode')).toHaveText('AUTO');
  await people.nth(0).getByRole('button',{name:'発話 ON',exact:true}).click();
  await expect(page.locator('#shot')).toHaveText('SINGLE',{timeout:8000});
  await people.nth(1).getByRole('button',{name:'発話 ON',exact:true}).click();
  await expect(page.locator('#shot')).toHaveText('TWO_SHOT',{timeout:8000});
  await expect(page.locator('#camera-transition')).toHaveText('MOVE');
  // Rendering keeps receiving frames during the move; it must not crash.
  await expect(overlay.locator('#scene')).toHaveAttribute('data-studio-status',/READY|STUDIO_/);
});
