import {expect,test} from './fixtures.ts';
import type {APIRequestContext} from '@playwright/test';
test.use({chatFixture:true});
const post=(request:APIRequestContext,id:string,content:string)=>request.post('http://127.0.0.1:31340/',{data:{cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:'200',message:{id,author:{id:'42',username:'テスト投稿者'},content,timestamp:new Date(1700000000000+Number(id)).toISOString()}}}});
test('VC-CHAT displays new posts without flags, links safely, tracks edits/deletes, survives Dock reload and clears on VC move',async({page,request,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/dock');await expect(page.locator('#vc-chat-status')).toContainText('受信中');
 const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 const calls:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:31339/'))calls.push(r.url());});
 await post(request,'1','テスト投稿です\n2行目 https://example.com/test');
 await expect(page.locator('.chat-message')).toHaveCount(1);await expect(page.locator('.chat-author')).toHaveText('テスト投稿者');
 await expect(page.locator('.chat-body')).toContainText('2行目');await expect(page.locator('.chat-body a')).toHaveAttribute('rel','noopener noreferrer');
 await post(request,'2','<img src="https://attacker.invalid/track" onerror="alert(1)">');
 await expect(page.locator('.chat-message')).toHaveCount(2);await expect(page.locator('#vc-chat-messages img')).toHaveCount(0);expect(calls).toEqual([]);
 await expect(overlay.locator('#vc-chat-panel')).toHaveCount(0);
 await page.reload();await expect(page.locator('.chat-message')).toHaveCount(2);
 await request.post('http://127.0.0.1:31340/',{data:{cmd:'DISPATCH',evt:'MESSAGE_UPDATE',data:{channel_id:'200',message:{id:'1',content:'編集しました',edited_timestamp:new Date().toISOString()}}}});
 await expect(page.locator('[data-message-id="1"]')).toContainText('編集しました');await expect(page.locator('[data-message-id="1"]')).toContainText('編集済み');
 await request.post('http://127.0.0.1:31340/',{data:{cmd:'DISPATCH',evt:'MESSAGE_DELETE',data:{channel_id:'200',message:{id:'2'}}}});await expect(page.locator('.chat-message')).toHaveCount(1);
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.work/rc14-vc-chat-${width}.png`,fullPage:true});}
 await request.post('http://127.0.0.1:31340/',{data:{action:'move',channelId:'201'}});await expect(page.locator('.chat-message')).toHaveCount(0);await expect(page.locator('#vc-chat-status')).toContainText('別のテストVC');
 await post(request,'3','旧チャンネル');await expect(page.locator('.chat-message')).toHaveCount(0);expect(errors).toEqual([]);
});
test('reading older posts does not jump to the bottom; new-post indicator resumes following',async({page,request})=>{
 await page.goto('/dock');await expect(page.locator('#vc-chat-status')).toContainText('受信中');
 for(let i=1;i<=30;i++)await post(request,String(i),`合成メッセージ ${i}\n本文テスト`);
 await expect(page.locator('.chat-message')).toHaveCount(30);
 await page.locator('#vc-chat-messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
 await post(request,'31','新しい投稿');await expect(page.locator('#vc-chat-latest')).toBeVisible();expect(await page.locator('#vc-chat-messages').evaluate(el=>el.scrollTop)).toBe(0);
 await page.locator('#vc-chat-latest').click();await expect(page.locator('#vc-chat-latest')).toBeHidden();
 expect(await page.locator('#vc-chat-messages').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(24);
 await request.post('http://127.0.0.1:31340/',{data:{action:'disconnect'}});await expect(page.locator('.chat-message')).toHaveCount(0);await expect(page.locator('#vc-chat-status')).toContainText('切断');
});
