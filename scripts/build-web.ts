import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { WebAssets } from '../src/server/app.ts';
export async function buildWeb(): Promise<WebAssets> {
  const assets:WebAssets={};
  for(const page of ['overlay','dock'] as const){
    const result=await Bun.build({entrypoints:[`src/web/${page}/main.ts`],target:'browser',format:'esm',minify:true,sourcemap:'none',naming:`${page}.js`});
    if(!result.success)throw new Error(result.logs.map(String).join('\n'));
    const js=result.outputs.find(o=>o.kind==='entry-point');if(!js)throw new Error('WEB_BUILD_MISSING');
    assets[`/static/${page}.js`]={body:await js.text(),type:'text/javascript; charset=utf-8'};
    assets[`/static/${page}.css`]={body:await readFile(`src/web/${page}/style.css`,'utf8'),type:'text/css; charset=utf-8'};
    assets[`/${page}`]={body:await readFile(`src/web/${page}/index.html`,'utf8'),type:'text/html; charset=utf-8'};
  }
  await mkdir('.generated',{recursive:true});await writeFile('.generated/web-assets.json',JSON.stringify(assets));
  console.log(`Embedded ${Object.keys(assets).length} web assets (${Math.round(Buffer.byteLength(JSON.stringify(assets))/1024)} KiB).`);
  return assets;
}
if(import.meta.main)await buildWeb();
