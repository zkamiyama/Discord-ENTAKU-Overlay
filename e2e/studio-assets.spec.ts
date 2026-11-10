import {expect,test} from './fixtures.ts';
import {zipSync} from 'fflate';
import {studioFixture} from '../tests/helpers/gltf.ts';
async function snapshot(page:any){return page.evaluate(()=>new Promise<any>(resolve=>{const w=new WebSocket('ws://'+location.host+'/ws');w.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='snapshot'){w.close();resolve(m.state);}};}));}
test('inline ZIP/GLTF loads relative assets without an editor and survives Dock reload',async({page,context})=>{
 const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const overlay=await context.newPage();overlay.on('pageerror',e=>errors.push(e.message));overlay.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:31339/'))external.push(r.url());});
 await overlay.goto(await page.locator('#overlay-url').inputValue());
 await expect(page.locator('#studio-editor')).toHaveCount(0);await expect(page.locator('#studio-pick')).toBeVisible();
 await page.locator('#studio-files').setInputFiles({name:'room.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(studioFixture()))});
 await expect(page.locator('#studio-feedback')).toHaveText('適用しました',{timeout:20000});
 await expect(overlay.locator('#scene')).toHaveAttribute('data-studio-status','READY');
 expect((await snapshot(page)).studio.objects).toHaveLength(1);expect((await snapshot(page)).studio.broadcast.enabled).toBe(false);
 await overlay.screenshot({path:'.work/rc12-inline-studio.png',omitBackground:true});
 await page.reload();await expect(page.locator('#studio-current')).toContainText('room.gltf');
 await page.locator('#studio-reset').click();await expect(page.locator('#studio-current')).toHaveText('標準セット');
 expect(external).toEqual([]);expect(errors).toEqual([]);
});
test('missing texture and invalid GLTF leave the current scene unchanged',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');const original=(await snapshot(page)).studio;
 const files=studioFixture();delete (files as Record<string,Uint8Array>)['textures/cutout.png'];
 await page.locator('#studio-files').setInputFiles({name:'incomplete.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(files))});
 await expect(page.locator('#studio-feedback')).toHaveText('STUDIO_DEPENDENCY_MISSING');expect((await snapshot(page)).studio).toEqual(original);
 await page.locator('#studio-files').setInputFiles({name:'bad.gltf',mimeType:'model/gltf+json',buffer:Buffer.from('{')});
 await expect(page.locator('#studio-feedback')).toHaveText(/STUDIO_/);expect((await snapshot(page)).studio).toEqual(original);
});
test('legacy JSON camera blockers still enforce a transparent safe wide without the old editor',async({page,context})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');const overlay=await context.newPage();await overlay.goto(await page.locator('#overlay-url').inputValue());
 const s=await snapshot(page);s.studio.camera={blockers:[{id:'blocked',min:[-100,-100,-100],max:[100,100,100]}]};
 expect(await page.evaluate(async s=>(await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'studio-set',scene:s.studio,expectedRevision:s.revision,requestId:crypto.randomUUID()})})).status,s)).toBe(200);
 await expect(overlay.locator('#scene')).toHaveAttribute('data-studio-status','CAMERA_SAFE_FALLBACK');await expect(page.locator('#shot')).toHaveText('WIDE');
 await page.locator('#studio-reset').click();await expect(overlay.locator('#scene')).toHaveAttribute('data-studio-status','READY');
});

test('studio GLB linked to a participant replaces the flat body and follows speaking, restart and unlink',async({page,context})=>{
 test.setTimeout(150000);const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const user=(await snapshot(page)).participants.find((p:any)=>p.presence==='present')!.userId;
 await page.locator('#studio-files').setInputFiles({name:'person.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(studioFixture()))});
 await expect(page.locator('#studio-feedback')).toHaveText('適用しました',{timeout:30000});
 await expect(page.locator('#studio-mesh-speaker-controls')).toBeVisible();
 await page.locator('#studio-mesh-speaker-controls summary').click();
 expect(await page.locator('#studio-speaker-model').inputValue()).toBe('studio');
 await page.locator('#studio-speaker-user').selectOption(user);
 await page.locator('#studio-speaker-apply').click();
 await expect.poll(async()=>(await snapshot(page)).studio.objects[0].speakerUserId).toBe(user);
 const overlay=await context.newPage();overlay.on('pageerror',e=>errors.push(e.message));
 await overlay.goto(await page.locator('#overlay-url').inputValue());
 await expect(overlay.locator('#scene')).toHaveAttribute('data-mesh-speaker-count','1',{timeout:30000});
 const send=async(active:boolean)=>{
  const state=await snapshot(page);
  const response=await page.evaluate(async({user,active,revision})=>fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'demo-speaking',userId:user,active,expectedRevision:revision,requestId:crypto.randomUUID()})}).then(r=>({status:r.status,body:r.text()})),{user,active,revision:state.revision});
  expect(response.status).toBe(200);
 };
 await send(true);await expect(overlay.locator('#scene')).toHaveAttribute('data-mesh-speaking','1',{timeout:15000});
 await send(false);await expect(overlay.locator('#scene')).toHaveAttribute('data-mesh-speaking','0',{timeout:15000});
 await page.reload();await expect(page.locator('#studio-speaker-user')).toHaveValue(user);
 await page.locator('#studio-mesh-speaker-controls summary').click();
 await page.locator('#studio-speaker-user').selectOption('');await page.locator('#studio-speaker-apply').click();
 await expect.poll(async()=>(await snapshot(page)).studio.objects[0].speakerUserId).toBeUndefined();
 await expect(overlay.locator('#scene')).toHaveAttribute('data-mesh-speaker-count','0',{timeout:15000});
 expect(errors).toEqual([]);
});
