import {expect,test} from './fixtures.ts';
test('overlay publishes READY only after the first authoritative frame is complete',async({page})=>{
 let held=true,received=0,release=()=>{};
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.routeWebSocket(/\/ws(?:\?|$)/,socket=>{
  const server=socket.connectToServer(),pending:(string|Buffer)[]=[];
  server.onMessage(message=>{
   const packet=JSON.parse(message.toString());
   if(held&&(packet.type==='snapshot'||packet.type==='snapshot-delta')){pending.push(message);received++;}
   else socket.send(message);
  });
  release=()=>{held=false;for(const message of pending)socket.send(message);pending.length=0;};
 });
 await page.goto('/overlay');
 await expect.poll(()=>received).toBeGreaterThan(0);
 const scene=page.locator('#scene');
 await expect(scene).toHaveAttribute('data-studio-status','STATE_WAITING');
 expect(await scene.getAttribute('data-camera-local-position')).toBeNull();
 release();
 await expect(scene).toHaveAttribute('data-studio-status','READY');
 for(const name of ['data-camera-local-position','data-camera-local-target']){
  const values=(await scene.getAttribute(name))!.split(',').map(Number);
  expect(values).toHaveLength(3);expect(values.every(Number.isFinite)).toBe(true);
 }
 expect(errors).toEqual([]);
});

test('frontal wide and near clip settings reach the renderer and survive Dock reload',async({page,context})=>{
 const errors:string[]=[];
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const overlay=await context.newPage();overlay.on('pageerror',e=>errors.push(e.message));
 await overlay.goto(await page.locator('#overlay-url').inputValue());const scene=overlay.locator('#scene');
 await expect(scene).toHaveAttribute('data-studio-status','READY');await expect(scene).toHaveAttribute('data-camera-near','0.15');
 const position=(await scene.getAttribute('data-camera-local-position'))!.split(',').map(Number);
 const target=(await scene.getAttribute('data-camera-local-target'))!.split(',').map(Number);
 expect(position[0]).toBe(0);expect(target[0]).toBe(0);expect(position[2]).toBeGreaterThan(target[2]!);
 await page.waitForTimeout(750);await overlay.screenshot({path:'.work/rc9-frontal-wide.png'});
 await page.locator('#camera-settings > summary').click();
 await page.locator('#camera-near').fill('0.35');await page.locator('#camera-near').press('Tab');
 await expect(scene).toHaveAttribute('data-camera-near','0.35');await expect(page.locator('#camera-near-slider')).toHaveValue('0.35');
 await page.reload();await expect(page.locator('#transport')).toHaveText('接続済み');await page.locator('#camera-settings > summary').click();await expect(page.locator('#camera-near')).toHaveValue('0.35');
 expect(errors).toEqual([]);
});
test('first real turn is eligible at 1.5 seconds and the leader label counts actual speech',async({page})=>{
 await page.goto('/dock');await expect(page.locator('#transport')).toHaveText('接続済み');
 const start=Date.now();await page.locator('.person').nth(1).getByRole('button',{name:'発話 ON',exact:true}).click();
 await page.waitForTimeout(600);await expect(page.locator('#shot')).toHaveText('WIDE');
 await expect(page.locator('#shot')).toHaveText('SINGLE',{timeout:7000});expect(Date.now()-start).toBeGreaterThan(1300);
 await expect(page.locator('#conversation-leader')).toContainText('ミナト');
});
