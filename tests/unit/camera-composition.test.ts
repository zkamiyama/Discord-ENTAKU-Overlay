import {expect,test} from 'bun:test';
import {makeLayout} from '../../src/geometry/capsule.ts';
import {planCamera,widePose,type AvatarExtent} from '../../src/domain/camera-planner.ts';
import {subjectsVisible,avatarOccluder} from '../../src/domain/camera-composition.ts';
import type {CameraPlan,Shot} from '../../src/contracts/domain.ts';
function scene(count=6){const l=makeLayout(count),m=new Map(l.seats.map((s,i)=>[String(i),s]));const pose=widePose(l.straightLength);const old:CameraPlan={id:0,shot:{kind:'WIDE',userIds:[]},reason:'BOOT',transition:'CUT',from:pose,to:pose,startMs:0,durationMs:0};return {l,m,old};}
test('single speaker is filmed from behind the opposing seat, never the table centre',()=>{
 const {l,m,old}=scene();const shot:Shot={kind:'SINGLE',userIds:['1']};const p=planCamera(old,shot,'TEST',m,l.straightLength,0);
 expect(p.composition).toBe('SINGLE_OTS');expect(p.foregroundUserId).toBe('2');expect(p.to.position[0]).toBeGreaterThan(m.get('2')!.position[0]);
 expect(subjectsVisible(p.to,shot.userIds,m,new Map())).toBe(true);
});
test('a tall wide foreground is moved around using the full image envelope, not its camera crop',()=>{
 const {l,m,old}=scene();const extents=new Map<string,AvatarExtent>([['2',{halfWidth:.2,topY:1.5,bottomY:1,bodyHalfWidth:1.25,bodyTopY:2.8,bodyBottomY:.75}]]);
 const p=planCamera(old,{kind:'SINGLE',userIds:['1']},'TEST',m,l.straightLength,0,extents);
 expect(subjectsVisible(p.to,['1'],m,extents)).toBe(true);
 expect(avatarOccluder(m.get('2')!,extents.get('2')!).max.y).toBe(2.8);
 expect(p.visibilityReason).not.toBe('NO_CLEAR_COMPOSITION');
});
test('absent participants cannot be selected as a foreground and single fallback is clear',()=>{
 const {l,m,old}=scene();m.delete('2');m.delete('4');m.delete('0');m.delete('5');
 const p=planCamera(old,{kind:'SINGLE',userIds:['1']},'TEST',m,l.straightLength,0);
 expect(p.foregroundUserId).toBeUndefined();expect(p.composition).toBe('SINGLE_CLEAN');expect(subjectsVisible(p.to,['1'],m,new Map())).toBe(true);
});
