import {expect,test} from 'bun:test';
import {normalizeParticipant,normalizeSnapshot} from '../../src/discord/normalize.ts';
test('voice snapshot is unknown speaking and volume is not treated as audio level',()=>{
 const p=normalizeParticipant({user:{id:'100',username:'name',global_name:'global',avatar:'a_abc'},nick:'名前',volume:100,voice_state:{self_mute:true}},'200');
 expect(p.displayName).toBe('名前');expect(p.speaking).toBe('unknown');expect(p.voice.selfMute).toBe(true);expect(p.avatarUrl).toContain('/100/a_abc.png');expect(p).not.toHaveProperty('level');
});
test('corrupt membership is not silently converted to an empty room',()=>{
 expect(()=>normalizeSnapshot({id:'200',type:2})).toThrow('SNAPSHOT_INCONSISTENT');
 expect(normalizeSnapshot(null)).toEqual({channel:null,participants:[]});
 expect(normalizeSnapshot({id:'200',type:13}).channel?.kind).toBe('unsupported');
});
