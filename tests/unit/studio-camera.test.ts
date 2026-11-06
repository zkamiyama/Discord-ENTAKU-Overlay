import { expect,test } from 'bun:test';
import { protectStudioCamera } from '../../src/studio/camera-safety.ts';
import { DEFAULT_STUDIO_SCENE,validateStudioScene } from '../../src/studio/manifest.ts';
import type { CameraPlan } from '../../src/contracts/domain.ts';
const pose={position:[0,3,6] as const,target:[0,1,0] as const,fov:45};
const plan=():CameraPlan=>({id:1,shot:{kind:'SINGLE',userIds:['1']},reason:'TEST',transition:'MOVE',from:{position:[-2,1.5,1],target:[-2,1.5,0],fov:35},to:{position:[2,1.5,1],target:[2,1.5,0],fov:35},startMs:0,durationMs:900});
test('camera path crossing a thin blocker uses CUT even when both endpoints are clear',()=>{
 const scene=structuredClone(DEFAULT_STUDIO_SCENE);scene.camera={blockers:[{id:'wall',min:[-.01,0,.8],max:[.01,3,1.2]}]};
 const result=protectStudioCamera(plan(),scene,pose);
 expect(result.transition).toBe('CUT');expect(result.safetyReason).toBe('STUDIO_PATH_BLOCKED');expect(result.to).toEqual(plan().to);
});
test('blocked destination falls back to wide and hides an enclosing studio when no clear camera exists',()=>{
 const scene=structuredClone(DEFAULT_STUDIO_SCENE);scene.camera={blockers:[{id:'enclosing',min:[-20,-10,-20],max:[20,20,20]}]};
 const result=protectStudioCamera(plan(),scene,pose);
 expect(result.shot.kind).toBe('WIDE');expect(result.studioHidden).toBe(true);expect(result.to).toEqual(pose);
});
test('world blockers follow the table anchor transform and invalid constraints fail validation',()=>{
 const scene=structuredClone(DEFAULT_STUDIO_SCENE);scene.tableAnchor.position=[10,0,0];scene.camera={blockers:[{id:'wall',min:[9.99,0,.8],max:[10.01,3,1.2]}]};
 expect(protectStudioCamera(plan(),scene,pose).transition).toBe('CUT');
 scene.camera.blockers[0]!.max=[9,1,1];expect(()=>validateStudioScene(scene)).toThrow('STUDIO_CAMERA_INVALID');
});
