import { expect,test } from 'bun:test';
import { AppEngine } from '../../src/domain/engine.ts';
import { startServer } from '../../src/server/app.ts';
import { DEFAULT_STUDIO_SCENE } from '../../src/studio/manifest.ts';
const keys={read:'1'.repeat(64),control:'2'.repeat(64)};
test('studio API separates import, draft and apply; read capabilities cannot mutate the scene',async()=>{
 const engine=new AppEngine({source:'demo',serverEpoch:'test'});
 const app=startServer({engine,keys,assets:{},port:0,now:()=>100});
 const origin=`http://127.0.0.1:${app.server.port}`;
 const auth={Origin:origin,Authorization:`Bearer ${keys.control}`};
 try{
  const form=new FormData();form.set('file:room.gltf',new Blob([JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0})]),'room.gltf');
  expect((await fetch(origin+'/api/studio/import',{method:'POST',body:form})).status).toBe(403);
  const response=await fetch(origin+'/api/studio/import',{method:'POST',headers:auth,body:form});
  expect(response.status).toBe(201);const bundle=await response.json();
  expect(engine.snapshot().studio.objects).toEqual([]);
  expect((await fetch(origin+'/api/studio/bundles/'+bundle.bundleId)).status).toBe(403);
  expect((await fetch(origin+'/api/studio/bundles/'+bundle.bundleId,{headers:{Authorization:`Bearer ${keys.read}`}})).status).toBe(200);
  const scene=structuredClone(DEFAULT_STUDIO_SCENE);scene.objects.push({id:'room',kind:'model',bundleId:bundle.bundleId,transform:{position:[0,0,0],yawDeg:0,scale:[1,1,1]}});
  const command={type:'studio-set',scene,expectedRevision:0,requestId:'studio-1'};
  const apply=()=>fetch(origin+'/api/commands',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(command)});
  expect((await apply()).status).toBe(200);expect(engine.snapshot().studio.revision).toBe(1);
  expect(engine.snapshot().studio.objects).toHaveLength(1);
  expect((await apply()).status).toBe(200);
  expect(engine.snapshot().studio.revision).toBe(1);
 }finally{await app.stop();}
});
