import {readFile} from 'node:fs/promises';
import {zipSync} from 'fflate';
import type {AppSnapshot} from '../src/contracts/domain.ts';
import {studioFixture} from '../tests/helpers/gltf.ts';
import {expect,test,type Page} from './fixtures.ts';

async function snapshot(page:Page,preview=false):Promise<AppSnapshot>{
 return page.evaluate(preview=>new Promise<AppSnapshot>((resolve,reject)=>{
  const url=new URL('/ws',location.href);url.protocol='ws:';if(preview)url.searchParams.set('environment','preview');
  const socket=new WebSocket(url);const timeout=setTimeout(()=>{socket.close();reject(new Error('SNAPSHOT_TIMEOUT'));},10000);
  socket.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.type==='snapshot'){clearTimeout(timeout);socket.close();resolve(message.state);}};
  socket.onerror=()=>{clearTimeout(timeout);socket.close();reject(new Error('SNAPSHOT_FAILED'));};
 }),preview);
}
async function downloadEnvironment(page:Page):Promise<Buffer>{
 const download=page.waitForEvent('download');await page.locator('#environment-package-export').click();
 const file=await download;expect(file.suggestedFilename()).toBe('entaku-environment.entaku.zip');
 const path=await file.path();expect(path).not.toBeNull();return readFile(path!);
}

test('environment ZIP restores settings and assets while saved cast stays in its own preview',async({page,context})=>{
 test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');await expect(page.locator('.person')).toHaveCount(6);
 await page.locator('#studio-files').setInputFiles({name:'room.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(studioFixture()))});
 await expect(page.locator('#studio-feedback')).toHaveText('適用しました',{timeout:30000});
 await page.locator('#camera-settings > summary').click();await page.locator('#camera-fov').fill('19');await page.locator('#camera-fov').press('Tab');
 await page.locator('#theme').selectOption('dark');
 await page.locator('#misskey-panel > summary').click();await page.locator('#misskey-tag').fill('移行前');await page.locator('#misskey-save').click();
 await expect(page.locator('#misskey-feedback')).toContainText('保存しました');
 await page.locator('#preset-select').selectOption('__new__');await page.locator('#preset-name').fill('保存した環境');await page.locator('#preset-save').click();
 await expect(page.locator('#preset-dialog')).not.toBeVisible();await expect(page.locator('#preset-select')).toHaveValue('保存した環境.json');
 await page.locator('#environment-package-open').click();const archive=await downloadEnvironment(page);
 await expect(page.locator('#environment-package-feedback')).toContainText('書き出しました');await page.locator('#environment-package-close').click();
 await page.locator('#camera-fov').fill('29');await page.locator('#camera-fov').press('Tab');await page.locator('#theme').selectOption('light');
 await page.locator('#studio-reset').click();await expect(page.locator('#studio-current')).toHaveText('標準セット');
 await page.locator('#misskey-tag').fill('変更後');await page.locator('#misskey-save').click();await expect(page.locator('#misskey-feedback')).toContainText('保存しました');
 await page.locator('#add').click();await expect(page.locator('.person')).toHaveCount(7);
 const liveIds=(await snapshot(page)).participants.map(person=>person.userId).sort();
 await page.locator('#environment-package-open').click();
 await page.locator('#environment-package-file').setInputFiles({name:'shared.entaku.zip',mimeType:'application/zip',buffer:archive});
 await expect(page.locator('#environment-package-review')).toBeVisible();await expect(page.locator('#environment-package-summary')).toContainText('6人');
 await expect(page.locator('#environment-package-summary')).toContainText('スタジオモデル');
 await expect(page.locator('#camera-fov')).toHaveValue('29');await expect(page.locator('#theme')).toHaveValue('light');
 expect((await snapshot(page)).studio.objects).toHaveLength(0);
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:900});
  expect(await page.locator('#environment-package-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:`.work/environment-package-${width}.png`,fullPage:true});
 }
 await page.locator('#environment-package-apply').click();await expect(page.locator('#environment-package-feedback')).toContainText('環境を適用しました');
 await expect(page.locator('#camera-fov')).toHaveValue('19');await expect(page.locator('#theme')).toHaveValue('dark');
 await expect(page.locator('#misskey-tag')).toHaveValue('移行前');await expect(page.locator('#preset-select')).toHaveValue('');
 await expect(page.locator('#studio-current')).toContainText('room.gltf');
 expect((await snapshot(page)).participants.map(person=>person.userId).sort()).toEqual(liveIds);
 await expect(page.locator('#environment-preview-link')).toHaveText('保存時の出演者でプレビュー');
 const preview=await context.newPage(),sockets:string[]=[],sent:string[]=[];preview.on('pageerror',error=>errors.push(error.message));
 preview.on('websocket',socket=>{sockets.push(socket.url());socket.on('framesent',frame=>sent.push(String(frame.payload)));});
 await preview.goto(await page.locator('#environment-preview-link').getAttribute('href')??'');
 await expect(preview.locator('#scene')).toHaveAttribute('data-studio-status','READY',{timeout:30000});
 expect(sockets.some(url=>new URL(url).searchParams.get('environment')==='preview')).toBe(true);
 expect(sent.some(frame=>/vc-chat-subscribe|misskey-subscribe/.test(frame))).toBe(false);
 const saved=await snapshot(page,true);expect(saved.participants.filter(person=>person.presence==='present')).toHaveLength(6);
 expect(saved.studio.objects).toHaveLength(1);
 await preview.screenshot({path:'.work/environment-preview.png',omitBackground:true});
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#environment-package-open').click();
 await expect(page.locator('#environment-preview-link')).toBeVisible();
 expect(errors).toEqual([]);
});

test('invalid ZIP leaves settings unchanged and a later selection replaces an earlier inspection',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#environment-package-open').click();
 const archive=await downloadEnvironment(page),original=(await snapshot(page)).studio;
 await page.locator('#environment-package-file').setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:Buffer.from('not a ZIP')});
 await expect(page.locator('#environment-package-feedback')).toHaveAttribute('data-error','true');
 await expect(page.locator('#environment-package-review')).not.toBeVisible();await expect(page.locator('#environment-package-apply')).toBeDisabled();
 expect((await snapshot(page)).studio).toEqual(original);
 let release:()=>void=()=>{},arrived:()=>void=()=>{};
 const pending=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{arrived=resolve;});
 await page.route('**/api/environment/inspect',async route=>{arrived();await pending;await route.continue();},{times:1});
 await page.locator('#environment-package-file').setInputFiles({name:'first.entaku.zip',mimeType:'application/zip',buffer:archive});await entered;
 await page.locator('#environment-package-file').setInputFiles({name:'second.entaku.zip',mimeType:'application/zip',buffer:archive});
 await expect(page.locator('#environment-package-filename')).toHaveText('second.entaku.zip');release();
 await expect(page.locator('#environment-package-filename')).toHaveText('second.entaku.zip');await expect(page.locator('#environment-package-apply')).toBeEnabled();
 expect((await snapshot(page)).studio).toEqual(original);
});

test('refreshing the shared settings generation never overwrites a concurrent Misskey change',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 await page.locator('#misskey-panel > summary').click();await expect(page.locator('#misskey-save')).toBeEnabled();
 await page.locator('#misskey-tag').fill('自分の下書き');
 const other=await context.newPage();await other.goto('/dock');await expect(other.locator('#transport')).toHaveText('接続済み');
 await other.locator('#misskey-panel > summary').click();await other.locator('#misskey-tag').fill('別の画面で保存');await other.locator('#misskey-save').click();
 await expect(other.locator('#misskey-feedback')).toContainText('保存しました');
 await page.locator('#misskey-save').click();await expect(page.locator('#misskey-feedback')).toContainText('設定が別の操作で更新されました');
 await expect(page.locator('#misskey-tag')).toHaveValue('別の画面で保存');
 const saved=await page.evaluate(async()=>await (await fetch('/api/misskey/settings')).json());
 expect(saved.settings.hashtag).toBe('別の画面で保存');
});
