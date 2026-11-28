import {readFile} from 'node:fs/promises';
import type {APIRequestContext} from '@playwright/test';
import type {NoteIntroductionSettings} from '../src/contracts/note-introduction.ts';
import {expect,test,type Page} from './fixtures.ts';

test.use({chatFixture:true,noteIntroductionFixture:true});
const controller='http://127.0.0.1:31342/';
async function importJson(page:Page,content:string):Promise<void> {
 const chooser=page.waitForEvent('filechooser');
 await page.locator('#note-introduction-import').click();
 await (await chooser).setFiles({name:'note-introduction.json',mimeType:'application/json',buffer:Buffer.from(content)});
}
async function share(request:APIRequestContext,id:string,url:string):Promise<void> {
 const response=await request.post('http://127.0.0.1:31340/',{data:{cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:'200',message:{
  id,author:{id:'42',username:'設定を試す人'},content:url,timestamp:new Date().toISOString(),
 }}}});
 expect(response.ok()).toBe(true);
}

test('Dock JSON configuration changes allowed origins, survives reload and exports exactly while invalid files preserve the active settings',async({page,request})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/dock');await expect(page.locator('#vc-chat-status')).toContainText('受信中');
 await page.locator('#note-introduction-settings > summary').click();
 await expect(page.locator('#note-introduction-import')).toBeEnabled();
 const original=await (await request.get('/api/note-introduction/settings')).json();
 const oldOrigin=original.settings.instances[0] as string;expect(oldOrigin).toBeTruthy();
 const settings:NoteIntroductionSettings={schemaVersion:1,enabled:true,instances:['https://stage.example.org'],includeHome:true};
 expect(oldOrigin).not.toBe(settings.instances[0]);

 await importJson(page,JSON.stringify(settings,null,2));
 await expect(page.locator('#note-introduction-feedback')).toContainText('設定を読み込み、保存しました');
 await expect(page.locator('#note-introduction-instances li')).toHaveText(settings.instances);
 await expect(page.locator('#note-introduction-scope')).toHaveText('パブリック・ホーム');
 const saved=await (await request.get('/api/note-introduction/settings')).json();
 expect(saved.settings).toEqual(settings);expect(saved.generation).toBeGreaterThan(original.generation);

 // Posting to the old origin must not start an HTTP request or reserve a card.
 await share(request,'1',`${oldOrigin}/notes/old-origin`);
 const ignored=await (await request.get(controller)).json();
 expect(ignored.requests).toEqual([]);expect(ignored.state.status).toBe('idle');
 await expect(page.locator('#note-introduction-current')).toBeHidden();
 const text='設定ファイルで追加したインスタンスのノートです。';
 expect((await request.post(controller,{data:{action:'seed',id:'configured',text}})).ok()).toBe(true);
 await share(request,'2',`${settings.instances[0]}/notes/configured`);
 await expect(page.locator('#note-introduction-body')).toHaveText(text);
 await expect(page.locator('#note-introduction-link')).toHaveAttribute('href',`${settings.instances[0]}/notes/configured`);
 const fetched=await (await request.get(controller)).json();
 expect(fetched.requests.map((entry:{id:string;url:string})=>({id:entry.id,url:entry.url}))).toEqual([{id:'configured',url:`${settings.instances[0]}/api/notes/show`}]);

 await page.reload();await expect(page.locator('#vc-chat-status')).toContainText('受信中');
 await page.locator('#note-introduction-settings > summary').click();
 await expect(page.locator('#note-introduction-export')).toBeEnabled();
 await expect(page.locator('#note-introduction-instances li')).toHaveText(settings.instances);
 await expect(page.locator('#note-introduction-body')).toHaveText(text);
 const downloading=page.waitForEvent('download');await page.locator('#note-introduction-export').click();
 const download=await downloading;expect(download.suggestedFilename()).toBe('note-introduction.json');
 const path=await download.path();expect(path).not.toBeNull();
 expect(JSON.parse(await readFile(path!,'utf8'))).toEqual(settings);

 for(const [content,message] of [
  ['{"schemaVersion":','JSONとして読み込めませんでした'],
  [JSON.stringify({...settings,instances:['https://127.0.0.1']}),'設定JSONの'],
 ] as const){
  await importJson(page,content);await expect(page.locator('#note-introduction-feedback')).toContainText(message);
  await expect(page.locator('#note-introduction-import')).toBeEnabled();
  expect(await (await request.get('/api/note-introduction/settings')).json()).toEqual(saved);
  await expect(page.locator('#note-introduction-instances li')).toHaveText(settings.instances);
  await expect(page.locator('#note-introduction-body')).toHaveText(text);
 }
 expect(errors).toEqual([]);
});
