import {expect,test} from 'bun:test';
import {SampleWindow,FrameMetrics} from '../../src/web/overlay/frame-metrics.ts';
import {parseRenderReport} from '../../src/server/render-report.ts';
test('bounded percentiles ignore invalid values and evict old samples',()=>{
 const window=new SampleWindow(4);
 for(const n of [1,2,3,4,5,NaN,-1])window.push(n);
 expect(window.summary()).toEqual({count:4,p50:3,p95:5,p99:5});
 window.clear();expect(window.size).toBe(0);
});
test('frame telemetry distinguishes CPU preparation, command submission and optional GPU',()=>{
 const metrics=new FrameMetrics();expect(metrics.report()).toBeUndefined();
 metrics.record(16,1,3);metrics.record(33,2,5);
 expect(metrics.report()).toEqual({frameSamples:2,frameP50Ms:16,frameP95Ms:33,frameP99Ms:33,prepareP95Ms:2,submitP95Ms:5});
 metrics.gpu.push(8);expect(metrics.report()?.gpuP95Ms).toBe(8);
 const packet={status:'READY',frameMs:16,drawCalls:10,triangles:20,...metrics.report()};
 expect(parseRenderReport(packet,0)).toMatchObject(metrics.report()!);
 expect(parseRenderReport({...packet,frameP95Ms:-1},0).frameP95Ms).toBeUndefined();
 expect(parseRenderReport({...packet,gpuP95Ms:NaN},0).gpuP95Ms).toBeUndefined();
 expect(()=>parseRenderReport({...packet,frameMs:NaN},0)).toThrow('INVALID_RENDER_REPORT');
});
