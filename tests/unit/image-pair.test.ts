import {expect,test} from 'bun:test';
import {loadImagePair} from '../../src/web/shared/image-pair.ts';
test('failed front/back pairs close the decoded companion, whichever promise resolves first',async()=>{
 for(const side of ['front','back'] as const){
  let closed=0;const image={close(){closed++;}},failure=new Error('DECODE_FAILED');
  await expect(loadImagePair(side==='front'?Promise.reject(failure):Promise.resolve(image),side==='back'?Promise.reject(failure):Promise.resolve(image))).rejects.toThrow('DECODE_FAILED');
  expect(closed).toBe(1);
 }
});
test('successful front-only and paired loads transfer ownership without closing images',async()=>{
 let closed=0;const a={close(){closed++;}},b={close(){closed++;}};
 expect(await loadImagePair(Promise.resolve(a))).toEqual([a,undefined]);
 expect(await loadImagePair(Promise.resolve(a),Promise.resolve(b))).toEqual([a,b]);expect(closed).toBe(0);
});
