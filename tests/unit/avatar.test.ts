import { expect, test } from 'bun:test';
import { inspectImage } from '../../src/assets/image.ts';
import { validateProfile, avatarBounds, imagePointToLocal, type ImageAvatarProfile } from '../../src/assets/avatar-profile.ts';
import { createDistanceField } from '../../src/assets/alpha-distance.ts';
import { png } from '../helpers/png.ts';
const profile: ImageAvatarProfile = { userId: '1', assetId: 'a'.repeat(64), image: { width: 64, height: 128, mime: 'image/png' }, faceRect: [.25, .1, .5, .25], scale: 1, offsetX: 0, offsetY: 0 };
test('image checks use content, bound dimensions, reject animation, trailing bytes and bad CRC', () => {
  expect(inspectImage(png())).toEqual({ width: 64, height: 128, mime: 'image/png' });
  expect(() => inspectImage(png(4097, 1))).toThrow('IMAGE_DIMENSIONS_REJECTED');
  expect(() => inspectImage(png(64, 128, true))).toThrow('ANIMATED_IMAGE_REJECTED');
  expect(() => inspectImage(Buffer.from('<svg/>'))).toThrow('IMAGE_FORMAT_REJECTED');
  expect(() => inspectImage(Buffer.concat([png(), Buffer.from('trailing')]))).toThrow('INVALID_IMAGE');
  const broken = png(); broken[29] = broken[29]! ^ 1;
  expect(() => inspectImage(broken)).toThrow('INVALID_IMAGE');
});
test('face normalization centres the face and preserves 0.28 metre height', () => {
  const valid = validateProfile(profile), [x, y, w, h] = valid.faceRect;
  expect(imagePointToLocal(valid, x + w / 2, y + h / 2)).toEqual([0, 0]);
  const top = imagePointToLocal(valid, .5, y), bottom = imagePointToLocal(valid, .5, y + h);
  expect(top[1] - bottom[1]).toBeCloseTo(.28, 8);
  expect(avatarBounds(valid).right - avatarBounds(valid).left).toBeCloseTo(.56, 8);
  expect(() => validateProfile({ ...profile, userId: 1 })).toThrow('INVALID_AVATAR_PROFILE');
  expect(() => validateProfile({ ...profile, faceRect: [.9, 0, .2, .2] })).toThrow('INVALID_FACE_RECT');
  expect(() => validateProfile({ ...profile, faceRect: [.1, .1, .1, .01] })).toThrow('FACE_RECT_TOO_SMALL');
  expect(validateProfile({ ...profile, scale: 2 }).scale).toBe(2);
  expect(() => validateProfile({ ...profile, scale: 3, faceRect:[0,.1,.1,.125] })).toThrow('AVATAR_TOO_WIDE');
});
test('distance map follows opaque pixels and transparent holes, not image rectangle', () => {
  const width = 15, height = 15, alpha = new Uint8Array(width * height);
  for (let y = 3; y <= 11; y++) for (let x = 3; x <= 11; x++) alpha[y * width + x] = 255;
  alpha[7 * width + 7] = 0;
  const field = createDistanceField(alpha, width, height);
  expect(field.data[0]).toBeGreaterThan(128);
  expect(field.data[4 * width + 4]).toBeLessThan(128);
  expect(field.data[7 * width + 7]).toBeGreaterThan(128);
  expect(field.data[0]).toBe(field.data[14]);
  for (const value of [0, 255]) {
    const all = createDistanceField(new Uint8Array(64).fill(value), 8, 8);
    expect([...all.data].every(n => Number.isFinite(n))).toBe(true);
    expect(all.data[0]).toBe(value === 0 ? 255 : 0);
  }
  expect(() => createDistanceField(new Uint8Array(4), 3, 2)).toThrow('INVALID_ALPHA_MASK');
});
test('distance transform matches brute-force Euclidean distances on deterministic random masks', () => {
  let seed=13;
  for(let trial=0;trial<20;trial++){
    const width=8,height=7,alpha=Uint8Array.from({length:width*height},()=>{seed=(seed*1664525+1013904223)>>>0;return seed%3?255:0;});
    const field=createDistanceField(alpha,width,height,16);
    for(let i=0;i<alpha.length;i++){
      const x=i%width,y=Math.floor(i/width);let inside=Infinity,outside=Infinity;
      for(let j=0;j<alpha.length;j++){const d=(x-j%width)**2+(y-Math.floor(j/width))**2;if(alpha[j])inside=Math.min(inside,d);else outside=Math.min(outside,d);}
      const expected=Math.round(255*Math.max(0,Math.min(1,.5+(Math.sqrt(inside)-Math.sqrt(outside))/32)));
      expect(field.data[i]).toBe(expected);
    }
  }
});
test('off-centre faces retain their full occupied width for adaptive layout', () => {
  const p=validateProfile({...profile,faceRect:[0,.1,.1,.25]});
  expect(avatarBounds(p).right).toBeGreaterThan(.5);
});
