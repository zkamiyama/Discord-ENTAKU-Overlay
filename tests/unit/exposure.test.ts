import {expect,test} from 'bun:test';
import {DEFAULT_EXPOSURE,BLENDER_REFERENCE_EXPOSURE,validateExposure,meterExposure,adaptExposure,useFallbackLights,MIN_EXPOSURE} from '../../src/studio/exposure.ts';
function patch(value:number,n=100,alpha=1){return Array.from({length:n},()=>[value,value,value,alpha]).flat();}
test('auto exposure is the default and legacy scenes need no new settings',()=>{
 expect(validateExposure(undefined)).toEqual(DEFAULT_EXPOSURE);expect(DEFAULT_EXPOSURE.mode).toBe('auto');
 expect(BLENDER_REFERENCE_EXPOSURE).toBeCloseTo(.002549,6);
 for(const e of [{...DEFAULT_EXPOSURE,compensationEV:Infinity},{...DEFAULT_EXPOSURE,mode:'other'},{...DEFAULT_EXPOSURE,manualExposure:0},{...DEFAULT_EXPOSURE,foo:true}])expect(()=>validateExposure(e)).toThrow('STUDIO_EXPOSURE_INVALID');
});
test('meter uses linear HDR, ignores clear alpha and trims tiny emissive highlights',()=>{
 expect(meterExposure(patch(.18))).toBeCloseTo(1,8);
 expect(meterExposure(patch(180))).toBeCloseTo(.001,8);
 expect(meterExposure([...patch(180),...patch(100000,100,0)])).toBeCloseTo(.001,8);
 expect(meterExposure([...patch(180),...patch(100000,2)])).toBeCloseTo(.001,8);
 expect(meterExposure(patch(0))).toBeNull();expect(meterExposure(patch(10,7))).toBeNull();
 expect(meterExposure(patch(1e10))).toBe(MIN_EXPOSURE);
});
test('EV adaptation is finite, bounded, monotonic and does not snap on a camera change',()=>{
 let current=1;for(let i=0;i<300;i++){const next=adaptExposure(current,.00255,1/60);expect(next).toBeLessThanOrEqual(current);expect(Math.log2(current/next)).toBeLessThanOrEqual(4/60+1e-8);current=next;}
 expect(current).toBeCloseTo(.00255,4);
 expect(adaptExposure(1,10,1/60)).toBeLessThan(1.02);expect(adaptExposure(.00255,1,0)).toBe(.00255);
});
test('authored model lights replace fallback lighting by default, never rescale imported units',()=>{
 expect(useFallbackLights(DEFAULT_EXPOSURE,9)).toBe(false);expect(useFallbackLights(DEFAULT_EXPOSURE,0)).toBe(true);
 expect(useFallbackLights({...DEFAULT_EXPOSURE,lighting:'studio'},0)).toBe(false);
 expect(useFallbackLights({...DEFAULT_EXPOSURE,lighting:'combined'},9)).toBe(true);
});

test('exposure-only changes preserve the live shot and validate persisted settings',async()=>{
 const {AppEngine}=await import('../../src/domain/engine.ts');const {demoEvents}=await import('../../src/replay/demo.ts');
 const {validateStudioScene}=await import('../../src/studio/manifest.ts');
 const engine=new AppEngine({source:'demo',serverEpoch:'exposure-test'});for(const e of demoEvents())engine.apply(e);engine.tick(3000);
 const id=engine.snapshot().participants[0]!.userId;engine.control({type:'shot',shot:{kind:'SINGLE',userIds:[id]}},engine.snapshot().revision,4000);
 const before=engine.snapshot();
 const next=validateStudioScene({...before.studio,exposure:{...DEFAULT_EXPOSURE,mode:'manual',manualExposure:BLENDER_REFERENCE_EXPOSURE}});
 engine.setStudioScene(next,before.revision,4100);const after=engine.snapshot();
 expect(after.camera).toEqual(before.camera);expect(after.revision).toBe(before.revision+1);expect(after.studio.exposure?.manualExposure).toBe(BLENDER_REFERENCE_EXPOSURE);
 expect(()=>validateStudioScene({...next,exposure:{...next.exposure,compensationEV:NaN}})).toThrow('STUDIO_EXPOSURE_INVALID');
});

test('unsupported HDR reports a manual fallback and display objects retain depth testing',async()=>{
 const THREE=await import('three');const {ExposureRenderer,protectDisplayObject}=await import('../../src/web/studio/exposure-renderer.ts');
 let draws=0;const renderer={extensions:{has:()=>false},render:()=>{draws++;}} as unknown as InstanceType<typeof THREE.WebGLRenderer>;
 const fallback=new THREE.Group(),exposure=new ExposureRenderer(renderer,fallback);
 const result=exposure.render(new THREE.Scene(),new THREE.PerspectiveCamera(),{...DEFAULT_EXPOSURE,manualExposure:.00255},'test',9,0);
 expect(result.exposureStatus).toBe('HDR_UNAVAILABLE');expect(result.exposure).toBe(.00255);expect(result.fallbackLights).toBe(false);
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());protectDisplayObject(mesh);
 expect(mesh.material.toneMapped).toBe(false);expect(mesh.layers.isEnabled(1)).toBe(true);expect(mesh.layers.isEnabled(0)).toBe(false);
 expect(mesh.material.depthTest).toBe(true);exposure.dispose();exposure.render(new THREE.Scene(),new THREE.PerspectiveCamera());expect(draws).toBe(1);
 mesh.geometry.dispose();mesh.material.dispose();
});
