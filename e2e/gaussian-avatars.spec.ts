import {expect,test,type Page} from './fixtures.ts';
import {personAction} from './controls.ts';
import {gaussianFixture} from '../tests/helpers/gaussian.ts';
import {png} from '../tests/helpers/png.ts';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {AppSnapshot} from '../src/contracts/domain.ts';
import type {StoredGaussianAsset} from '../src/assets/gaussian-store.ts';

async function snapshot(page:Page):Promise<AppSnapshot>{
  return page.evaluate(()=>new Promise<any>((resolve,reject)=>{
    const ws=new WebSocket('ws://'+location.host+'/ws');const timer=setTimeout(()=>{ws.close();reject(new Error('SNAPSHOT_TIMEOUT'));},10000);
    ws.onmessage=event=>{const m=JSON.parse(String(event.data));if(m.type==='snapshot'){clearTimeout(timer);ws.close();resolve(m.state);}};
  }));
}
async function command(page:Page,value:Record<string,unknown>):Promise<void>{
  const state=await snapshot(page);
  const result=await page.evaluate(async({value,revision})=>{
    const r=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,expectedRevision:revision,requestId:crypto.randomUUID()})});
    return {status:r.status,body:await r.text()};
  },{value,revision:state.revision});expect(result.status,result.body).toBe(200);
}
async function importFixture(page:Page,index:number):Promise<StoredGaussianAsset>{
  const bytes=Array.from(gaussianFixture(index).archive);
  return page.evaluate(async bytes=>{
    const form=new FormData();form.set('archive',new File([new Uint8Array(bytes)],'character.entaku.zip',{type:'application/zip'}));
    const r=await fetch('/api/gaussian-assets/import',{method:'POST',body:form});if(!r.ok)throw new Error(await r.text());return r.json();
  },bytes);
}
const profile=(asset:StoredGaussianAsset,userId:string)=>({kind:'gaussian',userId,assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0});
const ready=async(page:Page,count:number)=>{
  await expect(page.locator('#scene')).toHaveAttribute('data-gaussian-instances',String(count),{timeout:90000});
  await expect.poll(async()=>page.locator('#scene').getAttribute('data-gaussian-status').then(s=>JSON.parse(s??'[]').every((r:any)=>r.phase==='ready')),{timeout:90000}).toBe(true);
};
test.beforeAll(()=>mkdirSync('.work/gaussian',{recursive:true}));

test('eight distinct packages render offline, share unchanged speech data and mix with existing 2D',async({page,context})=>{
  test.setTimeout(240000);await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  await command(page,{type:'demo-add'});await command(page,{type:'demo-add'});
  let state=await snapshot(page);const ids=state.participants.filter(p=>p.presence==='present').slice(0,8).map(p=>p.userId),assets:StoredGaussianAsset[]=[];
  const scene={...state.studio,quality:{...state.studio.quality,shadows:'off',ao:'off',reflections:false,msaa:0,fxaa:false,gi:'off'},post:{...state.studio.post,enabled:false}};
  await command(page,{type:'studio-set',scene});
  for(let i=0;i<8;i++){const asset=await importFixture(page,i);assets.push(asset);await command(page,{type:'avatar-set',profile:profile(asset,ids[i]!)});}
  expect(new Set(assets.map(a=>a.assetId)).size).toBe(8);expect(new Set(assets.map(a=>a.splatCount)).size).toBe(8);
  await command(page,{type:'wide'});
  const overlay=await context.newPage();await overlay.setViewportSize({width:640,height:360});
  const errors:string[]=[],external:string[]=[];overlay.on('pageerror',e=>errors.push(e.message));
  await overlay.route('**/*',route=>{const url=new URL(route.request().url());if(url.host!=='127.0.0.1:31339'){external.push(url.href);return route.abort();}return route.continue();});
  await overlay.goto('/overlay');await ready(overlay,8);
  const before=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());
  const screenshot=await overlay.locator('#scene').screenshot({path:'.work/gaussian/eight-characters.png',omitBackground:true});
  const colors=await overlay.evaluate(async bytes=>{
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const c=canvas.getContext('2d')!;c.drawImage(bitmap,0,0);bitmap.close();const data=c.getImageData(0,0,canvas.width,canvas.height).data;
    let colored=0,transparent=0;for(let i=0;i<data.length;i+=4){if(data[i+3]!<8)transparent++;if(data[i+3]!>200&&Math.max(data[i]!,data[i+1]!,data[i+2]!)-Math.min(data[i]!,data[i+1]!,data[i+2]!)>90)colored++;}return {colored,transparent};
  },Array.from(screenshot));expect(colors.colored).toBeGreaterThan(300);
  await command(page,{type:'demo-speaking',userId:ids[0],active:true});await command(page,{type:'demo-speaking',userId:ids[0],active:false});
  const after=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());
  expect(after.assets.map((a:any)=>a.loadMs)).toEqual(before.assets.map((a:any)=>a.loadMs));
  expect(after.assets.map((a:any)=>a.decodeAndLodMs)).toEqual(before.assets.map((a:any)=>a.decodeAndLodMs));
  await command(page,{type:'demo-presence',userId:ids[0],present:false});await command(page,{type:'demo-presence',userId:ids[0],present:true});
  await command(page,{type:'seat-move',userId:ids[0],slotIndex:state.session.reservations.find(r=>r.userId===ids[1])!.slotIndex});
  const image=await page.request.post('/api/assets',{headers:{Origin:'http://127.0.0.1:31339','Content-Type':'image/png'},data:png()});expect(image.ok()).toBe(true);const imageAsset=await image.json();
  await command(page,{type:'avatar-set',profile:{userId:ids[0],assetId:imageAsset.assetId,image:{width:imageAsset.width,height:imageAsset.height,mime:imageAsset.mime},faceRect:[.25,.1,.5,.25],scale:1,offsetX:0,offsetY:0}});
  await ready(overlay,7);await overlay.locator('#scene').screenshot({path:'.work/gaussian/mixed-2d-3dgs.png',omitBackground:true});
  expect(external).toEqual([]);expect(errors).toEqual([]);
  writeFileSync('.work/gaussian/eight-results.json',JSON.stringify({assets:assets.map(a=>({assetId:a.assetId,splats:a.splatCount,bytes:a.byteLength})),before,after,colors},null,2));
});

test('Gaussian editor calibrates without image rectangles and exports portable placement',async({page})=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const person=page.locator('.person').first();await personAction(page,person,'アバターを調整');await page.locator('#avatar-kind').selectOption('gaussian');
  await expect(page.locator('#avatar-image-fields')).not.toBeVisible();
  await page.locator('#gaussian-file').setInputFiles({name:'synthetic.entaku.zip',mimeType:'application/zip',buffer:Buffer.from(gaussianFixture(2).archive)});
  await page.locator('#gaussian-import').click();await expect(page.locator('#gaussian-status')).toHaveAttribute('data-phase','ready',{timeout:90000});
  await page.locator('#gaussian-scale').fill('0.9');await page.locator('#gaussian-yaw').fill('25');await page.locator('#gaussian-offset-z').fill('0.1');
  await expect(page.locator('#avatar-apply')).toBeEnabled();
  const download=page.waitForEvent('download');await page.locator('#gaussian-export').click();const exported=await download;await exported.saveAs('.work/gaussian/editor-export.entaku.zip');
  await page.locator('#avatar-apply').click();await expect(page.locator('#avatar-editor')).not.toBeVisible();
  let state=await snapshot(page);const saved=state.avatarProfiles.find(p=>p.userId==='100')!;
  expect(saved.kind).toBe('gaussian');expect(saved.scale).toBe(.9);expect(saved).not.toHaveProperty('faceRect');
  await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await personAction(page,page.locator('.person').first(),'アバターを調整');
  await expect(page.locator('#gaussian-scale')).toHaveValue('0.9');await expect(page.locator('#gaussian-yaw')).toHaveValue('25');await expect(page.locator('#avatar-apply')).toBeEnabled({timeout:90000});
  await page.locator('#avatar-cancel').click();await personAction(page,page.locator('.person').nth(1),'アバターを調整');await page.locator('#avatar-kind').selectOption('gaussian');
  await page.locator('#gaussian-file').setInputFiles('.work/gaussian/editor-export.entaku.zip');await page.locator('#gaussian-import').click();await expect(page.locator('#avatar-apply')).toBeEnabled({timeout:90000});
  await expect(page.locator('#gaussian-scale')).toHaveValue('0.9');await expect(page.locator('#gaussian-yaw')).toHaveValue('25');await page.locator('#avatar-apply').click();
  state=await snapshot(page);const second=state.avatarProfiles.find(p=>p.userId==='101')!;expect(second.scale).toBe(saved.scale);expect(second.kind).toBe('gaussian');expect(errors).toEqual([]);
});

test('late A load and failed replacement cannot resurrect obsolete characters or stop another user',async({page,context})=>{
  test.setTimeout(180000);await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const a=await importFixture(page,0),b=await importFixture(page,1);
  await command(page,{type:'avatar-set',profile:profile(a,'100')});await command(page,{type:'avatar-set',profile:profile(b,'101')});
  const overlay=await context.newPage();await overlay.setViewportSize({width:480,height:270});
  let releaseA:()=>void=()=>{};const stalled=new Promise<void>(r=>{releaseA=r;});let arrived=false;
  await overlay.route(`**/api/gaussian-assets/${a.assetId}/file?*`,async route=>{arrived=true;await stalled;await route.continue().catch(()=>{});});
  await overlay.goto('/overlay');await expect.poll(()=>arrived).toBe(true);
  await command(page,{type:'avatar-set',profile:profile(b,'100')});releaseA();await ready(overlay,2);
  const shared=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());expect(shared.assets).toHaveLength(1);expect(shared.assets[0].references).toBe(2);
  await command(page,{type:'avatar-reset',userId:'100'});await ready(overlay,1);
  await overlay.route(`**/api/gaussian-assets/${a.assetId}/file?*`,route=>route.fulfill({status:500,body:'fixture failure'}));
  await command(page,{type:'avatar-set',profile:profile(a,'100')});
  await expect.poll(async()=>JSON.parse(await overlay.locator('#scene').getAttribute('data-gaussian-status')??'[]').some((s:any)=>s.userId==='100'&&s.phase==='error'),{timeout:90000}).toBe(true);
  expect(await overlay.locator('#scene').getAttribute('data-gaussian-instances')).toBe('1');
  const live=await overlay.evaluate(()=>(window as any).entakuGaussianDiagnostics());expect(live.assets.some((a:any)=>a.references===1&&a.inputSplats===b.splatCount)).toBe(true);
});
