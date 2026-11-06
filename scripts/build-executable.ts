import { mkdir, writeFile } from 'node:fs/promises';
import { buildWeb } from './build-web.ts';
export async function buildExecutable(target: 'bun-windows-x64-baseline' | 'bun-linux-x64-baseline' = process.platform === 'win32' ? 'bun-windows-x64-baseline' : 'bun-linux-x64-baseline'):Promise<string> {
  await buildWeb();
  await writeFile('.generated/entry.ts', `import assets from './web-assets.json';\nimport { entry } from '../src/cli.ts';\nawait entry(assets, true);\n`);
  await mkdir('dist',{recursive:true});
  const outfile=target.includes('windows')?'dist/ENTAKU-Overlay.exe':'dist/entaku-overlay';
  const result=await Bun.build({entrypoints:['.generated/entry.ts'],compile:{target,outfile},minify:true,sourcemap:'none'});
  if(!result.success)throw new Error(result.logs.map(String).join('\n'));
  console.log(`Built ${outfile} (${target}).`);return outfile;
}
if(import.meta.main){
  const args=process.argv.slice(2);
  const target=args.includes('--windows')?'bun-windows-x64-baseline':args.includes('--linux')?'bun-linux-x64-baseline':undefined;
  await buildExecutable(target);
}
