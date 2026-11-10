import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gaussianFixture} from '../tests/helpers/gaussian.ts';

/** Eight distinct, reproducible CC0 assets. No downloads or real user data. */
export function gaussianFixturePackages():Record<string,Uint8Array> {
  const files:Record<string,Uint8Array>={},index:Array<Record<string,unknown>>=[];
  for(let i=0;i<8;i++){
    const fixture=gaussianFixture(i),name=`character-${String(i+1).padStart(2,'0')}.entaku.zip`;
    files[name]=fixture.archive;
    index.push({name,character:fixture.manifest.name,format:'ply',splats:fixture.splatCount,bytes:fixture.archive.byteLength,sha256:createHash('sha256').update(fixture.archive).digest('hex'),color:fixture.color});
  }
  files['fixtures.json']=new TextEncoder().encode(JSON.stringify({license:'CC0-1.0',synthetic:true,performanceRepresentative:false,characters:index},null,2)+'\n');
  return files;
}
export async function generateGaussianFixtures(directory='.generated/gaussian-fixtures'):Promise<void> {
  await mkdir(directory,{recursive:true});
  for(const [name,bytes] of Object.entries(gaussianFixturePackages()))await writeFile(join(directory,name),bytes);
  console.log(`Generated eight distinct synthetic Gaussian packages in ${directory}`);
}
if(import.meta.main)await generateGaussianFixtures(process.argv[2]);
