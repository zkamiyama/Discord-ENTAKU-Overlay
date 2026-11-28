import {expect,test} from 'bun:test';
import {MISSKEY_CARD_HEIGHT,MISSKEY_CARD_RADIUS,MISSKEY_CARD_WIDTH,misskeyCardFacing,misskeyCardPosition} from '../../src/geometry/misskey-card-layout.ts';
import {MISSKEY_CARD_LIMIT} from '../../src/contracts/misskey.ts';

test('all 30 slots are finite, outside the seated capsule, and distinct across desk lengths',()=>{
  for(const length of [0,3.4,16,100]){
    const points=Array.from({length:MISSKEY_CARD_LIMIT},(_,slot)=>misskeyCardPosition(slot,length));
    expect(new Set(points.map(p=>`${p.x},${p.y},${p.z}`)).size).toBe(MISSKEY_CARD_LIMIT);
    for(const p of points){
      expect(Object.values(p).every(Number.isFinite)).toBe(true);
      expect(Math.hypot(p.x,Math.max(0,Math.abs(p.z)-length/2))).toBeCloseTo(MISSKEY_CARD_RADIUS,8);
      expect(Math.hypot(p.inwardX,p.inwardZ)).toBeCloseTo(1,8);
    }
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      const a=points[i]!,b=points[j]!;
      if(a.y===b.y)expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThan(MISSKEY_CARD_WIDTH);
      else expect(Math.abs(a.y-b.y)).toBeGreaterThan(MISSKEY_CARD_HEIGHT+.07);
    }
  }
});

test('opposite arrival pairs and all rows keep both sides balanced',()=>{
  for(const length of [0,8,100])for(const offset of [-20,0,15]){
    for(let pair=0;pair<MISSKEY_CARD_LIMIT;pair+=2){
      const a=misskeyCardPosition(pair,length,offset),b=misskeyCardPosition(pair+1,length,offset);
      expect(a.x+b.x).toBeCloseTo(0,8);
      expect(a.z+b.z).toBeCloseTo(2*offset,8);
      expect(a.y).toBe(b.y);
    }
  }
});

test('layout follows the desk offset without changing the radius or slot identity',()=>{
  for(let i=0;i<MISSKEY_CARD_LIMIT;i++){
    const old=misskeyCardPosition(i,6),moved=misskeyCardPosition(i,6,12);
    expect(moved.x).toBe(old.x);expect(moved.y).toBe(old.y);
    expect(moved.z-old.z).toBeCloseTo(12,10);
    expect(moved.inwardX).toBe(old.inwardX);expect(moved.inwardZ).toBe(old.inwardZ);
  }
});

test('per-view suppression removes the near side and preserves the far side',()=>{
  for(let i=0;i<MISSKEY_CARD_LIMIT;i++){
    const p=misskeyCardPosition(i,6,5);
    expect(misskeyCardFacing(p,p.x-p.inwardX,p.z-p.inwardZ)).toBe(0);
    expect(misskeyCardFacing(p,p.x+p.inwardX,p.z+p.inwardZ)).toBe(1);
    const midpoint=misskeyCardFacing(p,p.x+p.inwardX*.225,p.z+p.inwardZ*.225);
    expect(midpoint).toBeCloseTo(.5,8);
    expect(misskeyCardFacing(p,NaN,0)).toBe(0);
  }
});

test('invalid slot and layout input cannot produce unbounded or non-finite positions',()=>{
  for(const slot of [-1,.5,30,Infinity,NaN])expect(()=>misskeyCardPosition(slot,0)).toThrow('MISSKEY_SLOT_INVALID');
  for(const length of [-1,101,Infinity,NaN])expect(()=>misskeyCardPosition(0,length)).toThrow('MISSKEY_LAYOUT_INVALID');
  for(const offset of [-201,201,Infinity,NaN])expect(()=>misskeyCardPosition(0,0,offset)).toThrow('MISSKEY_LAYOUT_INVALID');
});
