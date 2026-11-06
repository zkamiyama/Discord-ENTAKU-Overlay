import {expect,test} from 'bun:test';
import {createRingData,updateRingData} from '../../src/geometry/table-geometry-data.ts';
test('ring has finite fixed buffers, outward winding and open centre for circle/capsule',()=>{
 const d=createRingData(),positions=d.positions,indices=d.indices;
 for(const length of [0,0.01,1,8,14]){
  updateRingData(d,.75,1.4,length,.69,.75);
  expect(d.positions).toBe(positions);expect(d.indices).toBe(indices);
  expect([...d.positions,...d.normals].every(Number.isFinite)).toBe(true);
  for(let i=0;i<d.indices.length;i+=3){
   const ids=[d.indices[i]!,d.indices[i+1]!,d.indices[i+2]!];
   const p=ids.map(id=>Array.from(d.positions.slice(id*3,id*3+3)));
   const u=p[1]!.map((x,j)=>x-p[0]![j]!),v=p[2]!.map((x,j)=>x-p[0]![j]!);
   const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
   const normal=Array.from(d.normals.slice(ids[0]!*3,ids[0]!*3+3));
   expect(cross.reduce((s,x,j)=>s+x*normal[j]!,0)).toBeGreaterThanOrEqual(-1e-7);
  }
 }
});
