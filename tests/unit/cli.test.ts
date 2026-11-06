import {expect,test} from 'bun:test';
import {parseOptions} from '../../src/cli-options.ts';
test('double-click default is demo and no flags cause Discord authorization',()=>{
 const o=parseOptions([]);expect(o.mode).toBe('demo');expect(o.compatibility).toBe(false);expect(o.consent).toBe(false);
});
test('live requires two explicit flags and doctor never authorizes',()=>{
 expect(()=>parseOptions(['--live'])).toThrow('COMPAT_CONSENT_REQUIRED');
 expect(()=>parseOptions(['--live','--compat-auth'])).toThrow('COMPAT_CONSENT_REQUIRED');
 expect(parseOptions(['--live','--compat-auth','--accept-streamkit-compat']).mode).toBe('ipc');
 expect(()=>parseOptions(['--doctor','--compat-auth'])).toThrow('DOCTOR_DOES_NOT_AUTHORIZE');
 expect(parseOptions(['--doctor','--client-id','123']).doctor).toBe(true);
});
test('CLI rejects conflicting sources, malformed port and unknown flags',()=>{
 expect(()=>parseOptions(['--demo','--replay','x.jsonl'])).toThrow('CONFLICTING_MODES');
 expect(()=>parseOptions(['--port','65536'])).toThrow('INVALID_PORT');
 expect(()=>parseOptions(['--port','12foo'])).toThrow('INVALID_PORT');
 expect(()=>parseOptions(['--unknown'])).toThrow('UNKNOWN_ARGUMENT');
 expect(()=>parseOptions(['--replay'])).toThrow('MISSING_ARGUMENT');
});
