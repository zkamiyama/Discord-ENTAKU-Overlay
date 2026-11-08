import {test as base,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
export {expect};
export type {Page,Locator} from '@playwright/test';
/** Every test owns an in-memory demo server. A failed editor or enclosure test
 * must not change the studio, participants or camera of the following test. */
export const test=base.extend<{demoServer:void}>({
 demoServer:[async({},use)=>{
  const child=spawn('bun',['run','scripts/e2e-server.ts'],{stdio:['ignore','pipe','pipe']});
  let log='';child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-12000);});
  const exited=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('DEMO_START_TIMEOUT\n'+log)),20000);let output='';
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('ENTAKU_E2E_READY')){clearTimeout(timer);resolve();}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('DEMO_START_FAILED_'+code+'\n'+log));});
   });
   await use();
  }finally{
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
   const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},5000);
   await exited;clearTimeout(timer);
  }
 },{auto:true}],
});
