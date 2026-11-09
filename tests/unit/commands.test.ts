import {test,expect} from 'bun:test';
import {parseCommand} from '../../src/contracts/commands.ts';
test('command parser rejects malformed envelopes and keeps asset validation at domain boundary',()=>{
 const envelope={requestId:'test',expectedRevision:0};
 expect(parseCommand({...envelope,type:'single',userId:'12'})).toMatchObject({type:'single',userId:'12'});
 expect(parseCommand({...envelope,type:'studio-set',scene:{}}).type).toBe('studio-set');
 for(const extra of [{type:'surprise'},{type:'release',userId:'12'},{type:'single',userId:'bad'},{type:'mode',mode:'bad'},{type:'replay-control',action:'rate',value:Infinity},{type:'moderators',userIds:[false]}])expect(()=>parseCommand({...envelope,...extra})).toThrow('INVALID_COMMAND');
 expect(()=>parseCommand({type:'wide',requestId:'a'})).toThrow('INVALID_COMMAND');
});
