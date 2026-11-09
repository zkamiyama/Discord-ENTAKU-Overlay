import {mkdtemp,copyFile,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const filename=process.platform==='win32'?'ENTAKU-VC-Chat-Probe.exe':'entaku-vc-chat-probe';
const dir=await mkdtemp(join(tmpdir(),'entaku-probe-smoke-'));
try{
 const executable=join(dir,filename);await copyFile(resolve('dist',filename),executable);
 const run=async(args:string[],flag?:string)=>{
  const env={...process.env,PATH:'',ENTAKU_PROBE_VC_CHAT:flag??''};
  const child=Bun.spawn([executable,...args],{cwd:dir,env,stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill(),5000);
  try{return {code:await child.exited,text:await new Response(child.stdout).text()+await new Response(child.stderr).text()};}finally{clearTimeout(timer);}
 };
 const disabled=await run(['--accept-streamkit-compat']);
 if(disabled.code!==2||!disabled.text.includes('PROBE_DISABLED_'))throw Error('PROBE_ENV_GATE_FAILED');
 const noConsent=await run([],'1');if(noConsent.code!==2||!noConsent.text.includes('COMPAT_CONSENT_REQUIRED'))throw Error('PROBE_CONSENT_GATE_FAILED');
 const help=await run(['--help']);if(help.code!==0||!help.text.includes('terminal only'))throw Error('PROBE_HELP_FAILED');
 if((await readdir(dir)).length!==1)throw Error('PROBE_UNEXPECTED_PERSISTENCE');
 console.log('Probe executable smoke passed: empty PATH; no Discord authorization, HTTP server or data files.');
}finally{await rm(dir,{recursive:true,force:true});}
