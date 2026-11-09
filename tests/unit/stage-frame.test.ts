import {test,expect} from 'bun:test';
import {PerspectiveCamera} from 'three';
import {sampleStage,sampleSeat,setLocalCamera} from '../../src/web/overlay/stage-frame.ts';
import {AppEngine} from '../../src/domain/engine.ts';
import {makeLayout} from '../../src/geometry/capsule.ts';
test('desk and seat animation share exact endpoints without mutating snapshots',()=>{
 const state=new AppEngine({source:'demo',serverEpoch:'test'}).snapshot(),old=makeLayout(4),next=makeLayout(8);
 state.straightLength=4;state.deskOffsetZ=2;
 state.layoutMotion={fromSeats:old.seats,fromStraightLength:0,fromDeskOffsetZ:0,startMs:1000,durationMs:1200};
 expect(sampleStage(state,0)).toEqual({length:0,offsetZ:0,progress:0});expect(sampleStage(state,2200)).toEqual({length:4,offsetZ:2,progress:1});
 const middle=sampleStage(state,1600);expect(middle).toEqual({length:2,offsetZ:1,progress:.5});
 const before=structuredClone(next.seats[1]!);const seat=sampleSeat(next.seats[1]!,old.seats[1]!,.5);expect(next.seats[1]).toEqual(before);expect(seat).not.toBe(next.seats[1]!);
 expect(sampleSeat(next.seats[1]!,old.seats[1]!,1)).toBe(next.seats[1]!);
});
test('camera presenter applies both projection parameters before avatar facing',()=>{
 const camera=new PerspectiveCamera(45,16/9,.1,100),pose={position:[1,2,3] as const,target:[0,1,0] as const,fov:22};
 setLocalCamera(camera,pose,.15);expect(camera.position.toArray()).toEqual([1,2,3]);expect(camera.fov).toBe(22);expect(camera.near).toBe(.15);
 const matrix=camera.projectionMatrix.clone();setLocalCamera(camera,pose,.15);expect(camera.projectionMatrix.equals(matrix)).toBe(true);
});
