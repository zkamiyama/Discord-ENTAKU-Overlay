import {expect,test} from 'bun:test';
import {avatarFacingYaw} from '../../src/geometry/avatar-facing.ts';
import {DEFAULT_QUALITY,validateQuality,hasScreenEffects} from '../../src/studio/quality.ts';
test('avatar facing reacts immediately and never retains a previous camera direction',()=>{
 const angle=Math.PI/6;
 expect(avatarFacingYaw(0,1,1)).toBeCloseTo(angle,12);
 expect(avatarFacingYaw(0,-1,1)).toBeCloseTo(-angle,12);
 expect(avatarFacingYaw(0,1,-1)).toBe(0);
 expect(avatarFacingYaw(Math.PI,-1,-1)-Math.PI).toBeCloseTo(angle,12);
 expect(avatarFacingYaw(0,0,0)).toBe(0);
 expect(()=>avatarFacingYaw(NaN,1,1)).toThrow('INVALID_AVATAR_FACING');
});
test('legacy quality settings acquire real MSAA and SSGI remains opt-in',()=>{
 const old=validateQuality({ao:'off',reflections:false,fxaa:false});
 expect(old.msaa).toBe(4);expect(old.renderScale).toBe(1);expect(old.gi).toBe('off');
 expect(hasScreenEffects(old)).toBe(true);
 expect(hasScreenEffects({...DEFAULT_QUALITY,msaa:0,ao:'off',reflections:false,fxaa:false})).toBe(false);
 expect(hasScreenEffects({...DEFAULT_QUALITY,msaa:0,gi:'ssgi'})).toBe(true);
 for(const q of [{msaa:3},{renderScale:4},{gi:'path-traced'},{giRadius:0},{giStrength:NaN},{giStrength:3}])expect(()=>validateQuality(q)).toThrow('STUDIO_QUALITY_INVALID');
});
