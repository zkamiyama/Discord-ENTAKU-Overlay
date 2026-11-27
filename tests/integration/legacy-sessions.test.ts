import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newSession} from '../../src/domain/seat-allocator.ts';
import {readLegacySessions} from '../../src/storage/legacy-sessions.ts';

test('legacy session discovery is read-only, source-scoped and tolerant of missing directories',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-legacy-sessions-'));
 try{
  expect(await readLegacySessions(directory)).toEqual([]);expect(await readdir(directory)).toEqual([]);
  const demo=join(directory,'sessions','demo'),ipc=join(directory,'sessions','ipc'),replay=join(directory,'sessions','replay');
  await Promise.all([mkdir(demo,{recursive:true}),mkdir(ipc,{recursive:true}),mkdir(replay,{recursive:true})]);
  const a=newSession('200','demo'),b=newSession('200','ipc'),original=JSON.stringify(a,null,3)+'\n';
  await Promise.all([writeFile(join(demo,'200.json'),original),writeFile(join(ipc,'200.json'),JSON.stringify(b)),writeFile(join(demo,'200.json.bak'),'backup'),writeFile(join(replay,'200.json'),'{broken replay')]);
  expect(await readLegacySessions(directory)).toEqual([{source:'demo',session:a},{source:'ipc',session:b}]);
  expect(await readFile(join(demo,'200.json'),'utf8')).toBe(original);
  expect(await readFile(join(demo,'200.json.bak'),'utf8')).toBe('backup');
  expect(await readFile(join(replay,'200.json'),'utf8')).toBe('{broken replay');
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
});

test('a malformed source or mismatched channel aborts legacy migration without modifying its JSON',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-legacy-invalid-'));
 try{
  const demo=join(directory,'sessions','demo'),ipc=join(directory,'sessions','ipc');
  await Promise.all([mkdir(demo,{recursive:true}),mkdir(ipc,{recursive:true})]);
  const valid=JSON.stringify(newSession('200','demo'));await writeFile(join(demo,'200.json'),valid);
  const broken=join(ipc,'200.json');await writeFile(broken,'{broken');
  await expect(readLegacySessions(directory)).rejects.toThrow('SESSION_READ_FAILED');
  expect(await readFile(broken,'utf8')).toBe('{broken');expect(await readFile(join(demo,'200.json'),'utf8')).toBe(valid);
  await writeFile(broken,JSON.stringify(newSession('201','wrong-channel')));
  await expect(readLegacySessions(directory)).rejects.toThrow('SESSION_READ_FAILED');
  await writeFile(broken,JSON.stringify({...newSession('200','invalid'),capacity:33}));
  await expect(readLegacySessions(directory)).rejects.toThrow('SESSION_READ_FAILED');
  await rm(broken);await mkdir(broken);
  await expect(readLegacySessions(directory)).rejects.toThrow('SESSION_READ_FAILED');
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
});

test('legacy session import enforces the byte limit before parsing and the per-source channel limit',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'entaku-legacy-limits-'));
 try{
  const root=join(directory,'sessions','ipc');await mkdir(root,{recursive:true});
  const session=newSession('200','limit'),json=JSON.stringify(session),maximum=1024*1024;
  const path=join(root,'200.json'),exact=' '.repeat(maximum-Buffer.byteLength(json))+json;
  await writeFile(path,exact);expect(await readLegacySessions(directory)).toEqual([{source:'ipc',session}]);
  await writeFile(path,' '+exact);await expect(readLegacySessions(directory)).rejects.toThrow('SESSION_READ_FAILED');
  await rm(path);
  await Promise.all(Array.from({length:1025},(_,i)=>writeFile(join(root,`${i+1}.json`),'{}')));
  await expect(readLegacySessions(directory)).rejects.toThrow('TOO_MANY_SESSIONS');
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
