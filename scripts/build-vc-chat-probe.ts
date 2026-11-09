import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const windows=process.argv.includes('--windows')||(!process.argv.includes('--linux')&&process.platform==='win32');
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
await mkdir('.generated',{recursive:true});await mkdir('dist',{recursive:true});
await writeFile('.generated/vc-chat-probe-entry.ts',`import {probeEntry} from '../scripts/probe-vc-chat.ts';\nawait probeEntry(${JSON.stringify(source+(dirty?'-dirty':''))});\n`);
const outfile=windows?'dist/ENTAKU-VC-Chat-Probe.exe':'dist/entaku-vc-chat-probe';
const result=await Bun.build({entrypoints:['.generated/vc-chat-probe-entry.ts'],compile:{target:windows?'bun-windows-x64-baseline':'bun-linux-x64-baseline',outfile},minify:true,sourcemap:'none'});
if(!result.success)throw new Error('PROBE_BUILD_FAILED');console.log(`Built ${outfile}; source=${source}${dirty?'-dirty':''}`);

await writeFile('dist/VC-CHAT-PROBE-BUILD.json',JSON.stringify({application:'ENTAKU VC Chat Probe',sourceCommit:source,dirty:!!dirty,runtime:Bun.version,target:windows?'windows-x64':'linux-x64',entry:'scripts/probe-vc-chat.ts'},null,2)+'\n');
