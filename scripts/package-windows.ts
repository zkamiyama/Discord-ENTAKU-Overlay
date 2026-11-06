import { VERSION, BUN_VERSION } from '../src/version.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { buildExecutable } from './build-executable.ts';
const clean=Bun.spawn(['git','status','--porcelain'],{stdout:'pipe',stderr:'pipe'});
const changes=await new Response(clean.stdout).text();
const cleanExit=await clean.exited;
if(cleanExit!==0)throw new Error('GIT_STATUS_FAILED');
if(changes.trim()){
  // Paths only, never file contents. Helps distinguish generated files from source edits.
  console.error(changes);
  throw new Error('COMMIT_CHANGES_BEFORE_PACKAGING');
}
const binary=await buildExecutable('bun-windows-x64-baseline');
const git=Bun.spawn(['git','ls-files','-z'],{stdout:'pipe',stderr:'pipe'});
const list=await new Response(git.stdout).text();if(await git.exited!==0)throw new Error('SOURCE_MANIFEST_FAILED');
const rev=Bun.spawn(['git','rev-parse','HEAD'],{stdout:'pipe',stderr:'pipe'});
const commit=(await new Response(rev.stdout).text()).trim();if(await rev.exited!==0)throw new Error('SOURCE_REVISION_FAILED');
const prefix='Discord-ENTAKU-Overlay/';const files:Record<string,Uint8Array>={};
files[prefix+'ENTAKU-Overlay.exe']=await readFile(binary);
files[prefix+'LICENSE']=await readFile('LICENSE');
files[prefix+'licenses/Bun-LICENSE.md']=await readFile('licenses/Bun-LICENSE.md');
files[prefix+'licenses/Three-LICENSE.txt']=await readFile('node_modules/three/LICENSE');
files[prefix+'THIRD_PARTY_NOTICES.md']=await readFile('THIRD_PARTY_NOTICES.md');
files[prefix+'START-HERE.txt']=Buffer.from(`Discord ENTAKU Overlay — ${VERSION}\r\n\r\n開発版です。安定版ではありません。\r\nBun/Node.jsのインストールは不要です。ZIPを展開してexeを起動してください。\r\n引数なしではデモのDockを開きます。Discord認可は開始しません。\r\nOBSブラウザソースには、Dock内の映像URLを設定します。\r\nOBSのカスタムブラウザドックには、起動コンソールのDock URLを設定します。\r\n終了するにはコンソールでCtrl+Cを押します。\r\n設定と席予約はexeと同じフォルダーのdataに保存します。\r\n\r\n実Discord接続の検証手順・未実装項目はsource/README.mdを参照してください。\r\nDockの「画像を調整」でPNG/静止WebPを選び、顔を囲んで適用できます。\r\nGLBスタジオ、独立した背面画像、3Dプレビューは未実装です。\r\n\r\nSource commit: ${commit}\r\nRuntime: Bun ${BUN_VERSION} (Windows x64 baseline)\r\n`,'utf8');
for(const path of list.split('\0').filter(Boolean)){
  if(path.startsWith('/')||path.split('/').includes('..'))throw new Error('INVALID_SOURCE_PATH');
  files[prefix+'source/'+path]=await readFile(path);
}
const manifest=Object.entries(files).map(([name,bytes])=>`${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}  ${name.slice(prefix.length)}`).join('\n')+'\n';
files[prefix+'SHA256SUMS.txt']=Buffer.from(manifest);
const output=`dist/Discord-ENTAKU-Overlay-${VERSION}-windows-x64.zip`;
await writeFile(output,zipSync(files,{level:6}));
console.log(`Created ${output}. Includes executable, notices and tracked application sources; excludes user data and credentials.`);
