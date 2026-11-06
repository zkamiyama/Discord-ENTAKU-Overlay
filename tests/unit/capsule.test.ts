import { expect, test } from 'bun:test';
import { makeLayout, perimeter, pointAtDistance, railPoints, solveStraightLength } from '../../src/geometry/capsule.ts';
test('capacity 1..32 fits chord distance and normalized inward directions', () => {
  for (let n=1;n<=32;n++) for (const phase of [0,0.25,0.5,0.9]) {
    const length=solveStraightLength(n,1.9,1.1,phase), points=railPoints(n,1.9,length,phase);
    for (let i=0;i<n;i++) {
      const a=points[i]!, b=points[(i+1)%n]!;
      expect(Math.hypot(a.inwardX,a.inwardZ)).toBeCloseTo(1,8);
      if(n>1) expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThanOrEqual(1.1-1e-8);
    }
  }
});
test('rail wraps, uses inward normals on straight sections, and rejects invalid widths', () => {
  expect(pointAtDistance(2,4,1)).toEqual({x:-1,z:2,inwardX:0,inwardZ:-1});
  expect(pointAtDistance(2,4,0).x).toBeCloseTo(pointAtDistance(2,4,perimeter(2,4)).x,8);
  expect(() => solveStraightLength(4,2,4)).toThrow('INVALID_PITCH');
  expect(() => makeLayout(0)).toThrow('INVALID_SEAT_COUNT');
});
