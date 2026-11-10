import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { VERSION } from '../src/version.ts';
const path=`dist/Discord-ENTAKU-Overlay-${VERSION}-windows-x64.zip`;
if((await stat(path)).size>256*1024*1024)throw new Error('PACKAGE_TOO_LARGE');
const bytes=await readFile(path),digest=createHash('sha256').update(bytes).digest('hex');
if((await readFile(path+'.sha256','utf8')).split(/\s+/)[0]!==digest)throw new Error('PACKAGE_HASH_MISMATCH');
let total=0,count=0;
const files=unzipSync(bytes,{filter:entry=>{
  total+=entry.originalSize;count++;
  if(entry.originalSize>256*1024*1024||total>512*1024*1024||count>2048)throw new Error('PACKAGE_EXPANSION_REJECTED');
  return true;
}});
const root='Discord-ENTAKU-Overlay/';
for(const path of Object.keys(files)){
  if(!path.startsWith(root)||path.includes('..')||path.includes('\\'))throw new Error('PACKAGE_PATH_INVALID');
  const relative=path.slice(root.length);
  if(/^(?:data\/)(?!README\.txt$)|(?:^|\/)(?:node_modules|\.git|\.generated|test-results)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:ttf|otf|woff2?)$/i.test(relative))throw new Error('PRIVATE_OR_UNEXPECTED_PACKAGE_FILE');
}
const requireFile=(name:string):Uint8Array=>{
  const value=files[root+name];if(!value?.length)throw new Error('PACKAGE_FILE_MISSING: '+name);return value;
};
for(const name of ['ENTAKU-Overlay.exe','Start-Demo.cmd','Start-Live.cmd','START-HERE.md','LICENSE','THIRD_PARTY_NOTICES.md','licenses/Apache-2.0.txt','licenses/Spark-LICENSE.txt','docs/acceptance.md','docs/gaussian-avatars.md','docs/gaussian-native-geometry.md','examples/studio-room.scene.json','examples/gaussian/fixtures.json','source/AGENTS.md'])requireFile(name);
for(let i=1;i<=8;i++){requireFile(`examples/gaussian/character-${String(i).padStart(2,'0')}.entaku.zip`);
 const native=unzipSync(requireFile(`examples/gaussian/character-${String(i).padStart(2,'0')}-native.entaku.zip`));
 if(Object.keys(native).some(name=>name.endsWith('.glb'))||JSON.parse(strFromU8(native['manifest.json']!)).proxy!==undefined)throw new Error('NATIVE_SAMPLE_CONTAINS_PROXY');}
const exe=requireFile('ENTAKU-Overlay.exe');if(exe[0]!==77||exe[1]!==90)throw new Error('PACKAGE_EXE_INVALID');
const info=JSON.parse(strFromU8(requireFile('BUILD-INFO.json')));
const head=Bun.spawnSync(['git','rev-parse','HEAD']);
if(head.exitCode!==0||info.sourceCommit!==head.stdout.toString().trim()||info.version!==VERSION||info.signed!==false)throw new Error('PACKAGE_BUILD_INFO_INVALID');
const manifest=strFromU8(requireFile('SHA256SUMS.txt')).trim().split('\n'),checked=new Set<string>();
for(const line of manifest){
  const match=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!match||checked.has(match[2]!))throw new Error('PACKAGE_MANIFEST_INVALID');
  const [hash,name]=[match[1]!,match[2]!];checked.add(name);
  if(createHash('sha256').update(requireFile(name)).digest('hex')!==hash)throw new Error('PACKAGE_CONTENT_HASH_MISMATCH');
}
if(checked.size!==Object.keys(files).length-1)throw new Error('PACKAGE_MANIFEST_INCOMPLETE');
console.log(`Verified ${Object.keys(files).length} package files; source ${info.sourceCommit}; SHA-256 ${digest}`);
