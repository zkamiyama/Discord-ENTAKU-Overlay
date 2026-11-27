import {expect,test} from 'bun:test';
import {AppEngine} from '../../src/domain/engine.ts';
import {ScenePresentation} from '../../src/web/overlay/scene-presentation.ts';

test('a pending or failed studio retains one structural generation while speech continues',()=>{
 const presentation=new ScenePresentation(),first=new AppEngine({source:'demo',serverEpoch:'test'}).snapshot();
 expect(presentation.resolve(null,null)).toBeNull();
 expect(presentation.resolve(first,first.studio)).toBe(first);
 const incoming=structuredClone(first);
 incoming.studio.revision++;
 incoming.studio.tableAnchor.position=[4,1,2];
 incoming.camera.shot={...incoming.camera.shot,kind:'SINGLE',userIds:['1']};
 incoming.participants.push({userId:'1',channelId:'1',username:'one',displayName:'one',presence:'present',speaking:'active',voice:{selfMute:false,selfDeaf:false,serverMute:false,serverDeaf:false}});
 const pending=presentation.resolve(incoming,first.studio)!;
 expect(pending.studio).toBe(first.studio);
 expect(pending.camera).toBe(first.camera);
 expect(pending.participants).toBe(incoming.participants);
 expect(pending.serverEpoch).toBe(incoming.serverEpoch);
 expect(presentation.resolve(incoming,first.studio)).toBe(pending);
 const stopped={...incoming,participants:incoming.participants.map(p=>({...p,speaking:'inactive' as const}))};
 const retained=presentation.resolve(stopped,first.studio)!;
 expect(retained.participants[0]!.speaking).toBe('inactive');
 expect(retained.camera).toBe(first.camera);
 expect(presentation.resolve(stopped,incoming.studio)).toBe(stopped);
 expect(incoming.studio.tableAnchor.position).toEqual([4,1,2]);
});

test('initial loading, nonstructural updates and clearing do not retain an obsolete camera plan',()=>{
 const presentation=new ScenePresentation(),first=new AppEngine({source:'demo',serverEpoch:'first'}).snapshot();
 expect(presentation.resolve(first,null)).toBe(first);
 expect(presentation.resolve(first,first.studio)).toBe(first);
 const second=structuredClone(first);second.studio.revision++;
 expect(presentation.resolve(second,second.studio)).toBe(second);
 presentation.clear();
 expect(presentation.resolve(null,null)).toBeNull();
 const restarted=new AppEngine({source:'demo',serverEpoch:'next'}).snapshot();
 expect(presentation.resolve(restarted,restarted.studio)).toBe(restarted);
});
