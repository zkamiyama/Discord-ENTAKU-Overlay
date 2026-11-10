import {expect,test,type Page} from './fixtures.ts';
import {personAction} from './controls.ts';
import {gaussianFixture} from '../tests/helpers/gaussian.ts';
import type {AppSnapshot} from '../src/contracts/domain.ts';
import type {GaussianAvatarProfile} from '../src/assets/gaussian-profile.ts';
import type {StoredGaussianAsset} from '../src/assets/gaussian-store.ts';

async function snapshot(page:Page):Promise<AppSnapshot>{
  return page.evaluate(()=>new Promise<AppSnapshot>((resolve,reject)=>{
    const ws=new WebSocket('ws://'+location.host+'/ws');
    const timer=setTimeout(()=>{ws.close();reject(new Error('SNAPSHOT_TIMEOUT'));},10000);
    ws.onmessage=event=>{
      const message=JSON.parse(String(event.data)) as {type:string;state?:AppSnapshot};
      if(message.type==='snapshot'&&message.state){clearTimeout(timer);ws.close();resolve(message.state);}
    };
  }));
}
async function command(page:Page,value:Record<string,unknown>):Promise<void>{
  const state=await snapshot(page);
  const response=await page.request.post('/api/commands',{
    headers:{Origin:new URL(page.url()).origin},
    data:{...value,expectedRevision:state.revision,requestId:crypto.randomUUID()},
  });
  expect(response.status(),await response.text()).toBe(200);
}
async function assets(page:Page):Promise<StoredGaussianAsset[]>{
  const response=await page.request.get('/api/gaussian-assets');
  expect(response.status()).toBe(200);return response.json();
}
function deferred(){
  let resolve!:()=>void;
  const promise=new Promise<void>(r=>{resolve=r;});
  return {promise,resolve};
}

test('ordinary point-cloud PLY shows the format explanation and preserves the assigned Gaussian and stored assets',async({page})=>{
  test.setTimeout(180000);
  await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const fixture=gaussianFixture(0,{proxy:false,count:64});
  const imported=await page.request.post('/api/gaussian-assets/import',{
    headers:{Origin:new URL(page.url()).origin},
    multipart:{archive:{name:'existing.entaku.zip',mimeType:'application/zip',buffer:Buffer.from(fixture.archive)}},
  });
  expect(imported.status()).toBe(201);
  const asset:StoredGaussianAsset=await imported.json();
  const profile:GaussianAvatarProfile={kind:'gaussian',userId:'100',assetId:asset.assetId,manifest:asset.manifest,scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0};
  await command(page,{type:'avatar-set',profile});
  await personAction(page,page.locator('.person[data-user-id="100"]'),'アバターを調整');
  await expect(page.locator('#gaussian-status')).toHaveAttribute('data-phase','ready',{timeout:90000});
  await expect(page.locator('#gaussian-assets')).toHaveValue(asset.assetId);
  const beforeProfiles=(await snapshot(page)).avatarProfiles,beforeAssets=await assets(page);

  const pointCloud=Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 255 0 0\n');
  await page.locator('#gaussian-file').setInputFiles({name:'point-cloud.ply',mimeType:'application/octet-stream',buffer:pointCloud});
  const rejected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/gaussian-assets/import'&&response.request().method()==='POST');
  await page.locator('#gaussian-import').click();
  const response=await rejected;expect(response.status()).toBe(422);expect(await response.json()).toEqual({error:'GAUSSIAN_PLY_NOT_3DGS'});
  await expect(page.locator('#gaussian-status')).toHaveAttribute('data-phase','error');
  await expect(page.locator('#gaussian-status')).toHaveText('通常の点群PLYには対応していません。回転・縮尺・不透明度を持つ3DGS形式のPLYを選んでください。');
  await expect(page.locator('#gaussian-assets')).toHaveValue(asset.assetId);
  await expect(page.locator('#gaussian-name')).toHaveValue(asset.manifest.name);
  expect((await snapshot(page)).avatarProfiles).toEqual(beforeProfiles);
  expect(await assets(page)).toEqual(beforeAssets);
  await page.locator('#avatar-cancel').click();
});

test('a delayed initial list cannot remove a newly imported character from the selected asset options',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
  const initialCaptured=deferred(),releaseInitial=deferred();
  let requests=0,initialAssets:StoredGaussianAsset[]|undefined;
  const completed:string[]=[];
  await page.route('**/api/gaussian-assets',async route=>{
    const number=++requests,response=await route.fetch();
    if(number===1){
      // Freeze the actual pre-import result, then let the post-import GET win.
      initialAssets=await response.json();initialCaptured.resolve();
      await releaseInitial.promise;
      await route.fulfill({response,json:initialAssets,headers:{...response.headers(),'x-entaku-test-list':'initial'}});
      completed.push('initial');
    }else{
      await route.fulfill({response});completed.push('latest');
    }
  });
  try{
    await personAction(page,page.locator('.person[data-user-id="100"]'),'アバターを調整');
    await initialCaptured.promise;expect(initialAssets).toEqual([]);
    await page.locator('#avatar-kind').selectOption('gaussian');
    const fixture=gaussianFixture(1,{proxy:false,count:64});
    await page.locator('#gaussian-file').setInputFiles({name:'new-character.entaku.zip',mimeType:'application/zip',buffer:Buffer.from(fixture.archive)});
    const imported=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/gaussian-assets/import'&&response.request().method()==='POST');
    await page.locator('#gaussian-import').click();
    const response=await imported;expect(response.status()).toBe(201);const asset:StoredGaussianAsset=await response.json();
    const select=page.locator('#gaussian-assets'),option=select.locator(`option[value="${asset.assetId}"]`);
    await expect(option).toHaveText(asset.manifest.name);await expect(select).toHaveValue(asset.assetId);
    expect(requests).toBe(2);expect(completed).toEqual(['latest']);

    const stale=page.waitForResponse(response=>response.headers()['x-entaku-test-list']==='initial');
    releaseInitial.resolve();await (await stale).finished();
    // Let fetch/json continuations and their DOM updates finish before asserting
    // preservation; an immediate assertion could pass before the stale overwrite.
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(completed).toEqual(['latest','initial']);
    await expect(select).toHaveValue(asset.assetId);await expect(option).toHaveText(asset.manifest.name);
    await expect(select.locator('option')).toHaveCount(2);
    await expect(page.locator('#gaussian-name')).toHaveValue(asset.manifest.name);
    expect((await snapshot(page)).avatarProfiles).toEqual([]);
    await page.locator('#avatar-cancel').click();
  }finally{
    releaseInitial.resolve();await page.unrouteAll({behavior:'wait'});
  }
});
