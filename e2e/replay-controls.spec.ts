import {expect,test} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {demoEvents} from '../src/replay/demo.ts';
test('replay CLI supports pause, speed and backward seek from the Dock without a Discord connection',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-replay-e2e-'));
 const file=join(dir,'test.jsonl');
 await writeFile(file,[JSON.stringify({kind:'header',schemaVersion:1,originMs:0,durationMs:10000}),...demoEvents().map(event=>JSON.stringify({kind:'provider',atMs:0,event:{...event,receivedAtMs:0}}))].join('\n'));
 const child=spawn('bun',['run','src/cli.ts','--replay',file,'--port','0','--safe-mode','--no-open'],{stdio:['ignore','pipe','pipe']});
 const exit=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 try{
  const dock=await new Promise<string>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('REPLAY_START_TIMEOUT')),10000);let output='';
   child.stdout.on('data',data=>{output+=data.toString();const match=/Dock:\s+(http:\/\/127\.0\.0\.1:\d+\/dock)/.exec(output);if(match){clearTimeout(timeout);resolve(match[1]!);}});
   child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('REPLAY_EXIT_'+code));});
  });
  await page.goto(dock);await expect(page.locator('#transport')).toHaveText('接続済み');await expect(page.locator('#replay-controls')).toBeVisible();
  await page.locator('#replay-play').click();await expect(page.locator('#replay-play')).toHaveText('再生');
  await page.locator('#replay-rate').selectOption('2');
  await page.locator('#replay-seek').fill('7000');await page.locator('#replay-seek').dispatchEvent('change');await expect(page.locator('#replay-time')).toContainText('7.0 / 10.0秒');
  await page.locator('#replay-seek').fill('1000');await page.locator('#replay-seek').dispatchEvent('change');await expect(page.locator('#replay-time')).toContainText('1.0 / 10.0秒');
  await page.locator('#replay-play').click();await expect(page.locator('#replay-play')).toHaveText('一時停止');
  await expect(page.locator('#record-start')).toBeDisabled();
 }finally{child.kill('SIGTERM');await exit;await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
