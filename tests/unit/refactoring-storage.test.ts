import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PresetStore} from '../../src/presets/store.ts';
import {capturePreset} from '../../src/presets/schema.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {webTemplate} from '../../scripts/web-template.ts';
import {fitImage,imagePoint} from '../../src/web/dock/image-selection.ts';

test('preset index avoids repeated parsing but notices edit, corruption and deletion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-index-')),store=new PresetStore(dir);
 const preset=capturePreset(new AppEngine({source:'demo',serverEpoch:'test'}).snapshot(),'dark');
 try{
  await store.create('sample',preset);let reads=0;const read=store.read.bind(store);store.read=async name=>{reads++;return read(name);};
  expect((await store.list())[0]!.valid).toBe(true);await store.list();expect(reads).toBe(1);
  await writeFile(join(dir,'presets','sample.json'),'bad');expect((await store.list())[0]!.valid).toBe(false);expect(reads).toBe(2);
  await writeFile(join(dir,'presets','sample.json'),JSON.stringify(preset));expect((await store.list())[0]!.valid).toBe(true);
  const first=await store.list();first[0]!.valid=false;expect((await store.list())[0]!.valid).toBe(true);
  await rm(join(dir,'presets','sample.json'));expect(await store.list()).toEqual([]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('build template keeps source order and rejects cycles and parent traversal',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'entaku-template-'));
 try{
  await writeFile(join(dir,'part.html'),'body');await writeFile(join(dir,'root.html'),'before<!-- @include part.html -->after');expect(await webTemplate(join(dir,'root.html'))).toBe('beforebodyafter');
  await writeFile(join(dir,'part.html'),'<!-- @include root.html -->');await expect(webTemplate(join(dir,'root.html'))).rejects.toThrow('WEB_TEMPLATE_REJECTED');
  await writeFile(join(dir,'part.html'),'<!-- @include ../outside.html -->');await expect(webTemplate(join(dir,'root.html'))).rejects.toThrow('WEB_TEMPLATE_REJECTED');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('image selection normalizes pointer coordinates for portrait and landscape images',()=>{
 const fit=fitImage(100,200,480,480);expect(fit.w).toBeCloseTo(224);expect(fit.h).toBeCloseTo(448);
 const bounds={left:10,top:20,width:240,height:240};
 expect(imagePoint(130,140,bounds,480,480,fit)).toEqual({x:.5,y:.5});
 expect(imagePoint(-100,-100,bounds,480,480,fit)).toEqual({x:0,y:0});
 expect(imagePoint(1000,1000,bounds,480,480,fit)).toEqual({x:1,y:1});
});
