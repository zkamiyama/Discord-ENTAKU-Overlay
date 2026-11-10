import {mkdir,copyFile} from 'node:fs/promises';
const output='.work/fresnel-preview';
await mkdir(output,{recursive:true});
const build=await Bun.build({entrypoints:['experiments/gaussian-fresnel-preview/main.ts'],target:'browser',outdir:output,naming:'main.js'});
if(!build.success)throw new AggregateError(build.logs,'FRESNEL_PREVIEW_BUILD_FAILED');
await copyFile('experiments/gaussian-fresnel-preview/index.html',`${output}/index.html`);
const child=Bun.spawn(['node','experiments/gaussian-fresnel-preview/render.mjs'],{stdin:'ignore',stdout:'inherit',stderr:'inherit'});
const code=await child.exited;if(code!==0)process.exit(code);
