import {expect,test} from 'bun:test';
import {Matrix4,Vector3} from 'three';
import {DEFAULT_POST,NATURAL_POST,validatePost,hasPostEffects,resolvePostFocus} from '../../src/studio/post-effects.ts';
import {layoutNameGlyphs,nameGraphemes} from '../../src/geometry/nameplate-text.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {demoEvents} from '../../src/replay/demo.ts';
import {validateStudioScene} from '../../src/studio/manifest.ts';
test('post defaults are neutral, protect display art, and speech glow defaults to four times',()=>{
 expect(validatePost(undefined)).toEqual(DEFAULT_POST);expect(hasPostEffects(DEFAULT_POST)).toBe(false);expect(DEFAULT_POST.excludeAvatars).toBe(true);expect(DEFAULT_POST.speechGlowScale).toBe(4);
 expect(hasPostEffects(NATURAL_POST)).toBe(true);expect(hasPostEffects({...NATURAL_POST,enabled:false})).toBe(false);
 for(const bad of [{saturation:NaN},{contrast:0},{maxBlur:17},{focusMode:'centre'},{dof:'yes'},{focusDistance:0},{speechGlowScale:9},{arbitrary:true}])expect(()=>validatePost(bad)).toThrow('STUDIO_POST_INVALID');
});
test('focus covers both subjects in view depth and can extend behind them or be fixed',()=>{
 const pose={position:[0,0,10] as const,target:[0,0,0] as const,fov:45};
 const subjects:[[number,number,number],[number,number,number]]=[[3,0,2],[-3,0,0]];
 expect(resolvePostFocus({...DEFAULT_POST,focusMode:'subject'},pose,subjects)).toEqual({distance:9,range:1});
 expect(resolvePostFocus({...DEFAULT_POST,focusOffset:1},pose,subjects)).toEqual({distance:10,range:2});
 expect(resolvePostFocus({...DEFAULT_POST,focusMode:'manual',focusDistance:3,focusRange:.3},pose,subjects)).toEqual({distance:3,range:.3});
 const m=new Matrix4().makeRotationY(.73).setPosition(8,4,-3),t=(p:readonly number[])=>new Vector3().fromArray(p).applyMatrix4(m).toArray();
 const transformed=resolvePostFocus({...DEFAULT_POST,focusMode:'subject'},{position:t(pose.position),target:t(pose.target),fov:45},subjects.map(t));expect(transformed.distance).toBeCloseTo(9,10);expect(transformed.range).toBeCloseTo(1,10);
 expect(Number.isFinite(resolvePostFocus(DEFAULT_POST,pose,[]).distance)).toBe(true);
});
test('short names use tracking with bounded glyph width; long names never truncate',()=>{
 const short=layoutNameGlyphs([264,264],1480);expect(short.scaleX).toBe(1.1);expect(short.gap).toBeGreaterThan(800);expect(short.positions[1]!+264*short.scaleX).toBeCloseTo(1480,8);
 const long=nameGraphemes('長い表示名'.repeat(30));expect(long).toHaveLength(150);const l=layoutNameGlyphs(long.map(()=>264),1480);expect(l.scaleX).toBeLessThan(.05);expect(l.gap).toBeCloseTo(0);expect(l.positions.at(-1)!+264*l.scaleX).toBeCloseTo(1480,6);
 const one=layoutNameGlyphs([264],1480);expect(one.scaleX).toBe(1.1);expect(one.positions[0]).toBeCloseTo((1480-264*1.1)/2);
 expect(nameGraphemes('👨‍👩‍👧‍👦か\u3099')).toHaveLength(2);
});
test('post-only edits persist without moving seats or resetting a shot',()=>{
 const e=new AppEngine({source:'demo',serverEpoch:'post'});for(const event of demoEvents())e.apply(event);e.tick(3000);
 const old=e.snapshot(),scene=validateStudioScene({...old.studio,post:NATURAL_POST});e.setStudioScene(scene,old.revision,3100);
 expect(e.snapshot().camera).toEqual(old.camera);expect(e.snapshot().session).toEqual(old.session);expect(e.snapshot().studio.post).toEqual(NATURAL_POST);
});
