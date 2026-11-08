import {personAction} from './controls.ts';
import {expect,test,type Page} from './fixtures.ts';
async function centerPixel(page:Page):Promise<number[]>{
  const bytes=await page.locator('#avatar-3d-preview').screenshot();
  return page.evaluate(async base64=>{
    const raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const image=await createImageBitmap(new Blob([raw],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
    const pixel=Array.from(context.getImageData(Math.floor(image.width/2),Math.floor(image.height/2),1,1).data);image.close();return pixel;
  },bytes.toString('base64'));
}
for(const independentBack of [false,true])test(`avatar rear darkens with independent back=${independentBack}`,async({page})=>{
  await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const solid=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=128;const x=c.getContext('2d')!;x.fillStyle='rgb(200,40,40)';x.fillRect(0,0,64,128);return c.toDataURL('image/png').split(',')[1]!;});
  await personAction(page,page.locator('.person').first(),'画像を調整');
  await page.locator('#avatar-file').setInputFiles({name:'red.png',mimeType:'image/png',buffer:Buffer.from(solid,'base64')});
  await expect(page.locator('#avatar-apply')).toBeEnabled();
  if(independentBack){await page.locator('#avatar-editor details').first().locator('summary').click();await page.locator('#avatar-back-file').setInputFiles({name:'back.png',mimeType:'image/png',buffer:Buffer.from(solid,'base64')});await expect(page.locator('#avatar-apply')).toBeEnabled();}
  await page.locator('#avatar-3d-preview').scrollIntoViewIfNeeded();await page.waitForTimeout(300);
  const front=await centerPixel(page),box=(await page.locator('#avatar-3d-preview').boundingBox())!;
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+box.height/2,y,{steps:12});await page.mouse.up();
  await page.waitForTimeout(1200);const back=await centerPixel(page);
  expect(front[0]!).toBeGreaterThan(front[1]!+50);
  expect(back[0]!).toBeGreaterThan(back[1]!+30);
  expect(back[0]!).toBeLessThan(front[0]!-12);
  await page.locator('#avatar-cancel').click();
});
