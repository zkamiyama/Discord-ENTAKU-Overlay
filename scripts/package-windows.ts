import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { VERSION, BUN_VERSION } from '../src/version.ts';
import { buildExecutable } from './build-executable.ts';

const git = (...args:string[]) => {
  const result=Bun.spawnSync(['git',...args]);
  if(result.exitCode!==0)throw new Error('GIT_SOURCE_UNAVAILABLE');
  return result.stdout.toString().trim();
};
if(git('status','--porcelain'))throw new Error('PACKAGE_REQUIRES_CLEAN_SOURCE');
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(pkg.version!==VERSION)throw new Error('VERSION_MISMATCH');
if(Bun.version!==BUN_VERSION)throw new Error('BUILD_RUNTIME_VERSION_MISMATCH');
const sourceCommit=git('rev-parse','HEAD');
// Build from the clean source being packaged, never reuse a stale dist executable.
await buildExecutable('bun-windows-x64-baseline');
const root='Discord-ENTAKU-Overlay/';
const files:Record<string,Uint8Array>={};
const add=(path:string,bytes:Uint8Array)=>{files[root+path]=bytes;};
const executable=await readFile('dist/ENTAKU-Overlay.exe');
if(executable[0]!==0x4d||executable[1]!==0x5a)throw new Error('WINDOWS_EXECUTABLE_REQUIRED');
add('ENTAKU-Overlay.exe',executable);
for(const name of ['Start-Demo.cmd','Start-Live.cmd'])add(name,strToU8((await readFile('scripts/'+name,'utf8')).replace(/\r?\n/g,'\r\n')));
add('START-HERE.md',await readFile('docs/getting-started.md'));
add('README.md',await readFile('README.md'));
add('LICENSE',await readFile('LICENSE'));
add('THIRD_PARTY_NOTICES.md',await readFile('THIRD_PARTY_NOTICES.md'));
for(const [target,source] of Object.entries({
  'licenses/Bun-LICENSE.md':'licenses/Bun-LICENSE.md',
  'licenses/Apache-2.0.txt':'licenses/Apache-2.0.txt',
  'licenses/three-LICENSE.txt':'node_modules/three/LICENSE',
  'licenses/Phosphor-LICENSE.txt':'node_modules/@phosphor-icons/core/LICENSE',
  'licenses/fflate-LICENSE.txt':'node_modules/fflate/LICENSE',
  'licenses/meshoptimizer-LICENSE.md':'node_modules/meshoptimizer/LICENSE.md',
  'licenses/Draco-README.md':'node_modules/three/examples/jsm/libs/draco/README.md',
  'licenses/Basis-README.md':'node_modules/three/examples/jsm/libs/basis/README.md',
}))add(target,await readFile(source));
const tracked=git('ls-files','-z').split('\0').filter(Boolean);
for(const path of tracked){
  if(/^(data|dist|node_modules|\.work|\.generated)\//.test(path)||/^\.env/.test(path))throw new Error('PRIVATE_OR_GENERATED_FILE_TRACKED');
  const content=await readFile(path);add('source/'+path,content);
  if(path.startsWith('docs/')||path.startsWith('examples/'))add(path,content);
}
add('BUILD-INFO.json',strToU8(JSON.stringify({application:'Discord ENTAKU Overlay',version:VERSION,sourceCommit,bun:Bun.version,target:'windows-x64-baseline',signed:false,releaseStage:'candidate'},null,2)+'\n'));
add('data/README.txt',strToU8('Settings and custom assets are created here at runtime.\nKeep personal data private. Local page access requires no key.\n'));
const sums=Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,bytes])=>`${createHash('sha256').update(bytes).digest('hex')}  ${path.slice(root.length)}`).join('\n')+'\n';
add('SHA256SUMS.txt',strToU8(sums));
await mkdir('dist',{recursive:true});
const output=`dist/Discord-ENTAKU-Overlay-${VERSION}-windows-x64.zip`;
if(git('rev-parse','HEAD')!==sourceCommit||git('status','--porcelain'))throw new Error('SOURCE_CHANGED_DURING_PACKAGING');
const archive=zipSync(files,{level:6});await writeFile(output,archive);
const digest=createHash('sha256').update(archive).digest('hex');
await writeFile(output+'.sha256',`${digest}  ${output.slice(5)}\n`);
console.log(`Packaged ${output}: ${archive.length} bytes; source ${sourceCommit}; SHA-256 ${digest}`);
