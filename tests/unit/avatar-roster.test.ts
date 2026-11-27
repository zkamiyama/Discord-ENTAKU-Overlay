import {expect,test} from 'bun:test';
import type {AppSnapshot,Participant} from '../../src/contracts/domain.ts';
import type {AvatarProfile} from '../../src/assets/avatar-profile.ts';
import {AvatarRoster,type RosterVisual} from '../../src/web/overlay/roster.ts';
import {AppEngine} from '../../src/domain/engine.ts';
function person(id:string,presence:Participant['presence']='present'):Participant {
 return {userId:id,channelId:'1',username:id,displayName:id,presence,speaking:'inactive',voice:{selfMute:false,selfDeaf:false,serverMute:false,serverDeaf:false}};
}
function state(people:Participant[],assigned:string[]):AppSnapshot{
 const s=new AppEngine({source:'demo',serverEpoch:'test'}).snapshot();
 s.participants=people;s.session.reservations=assigned.map((userId,slotIndex)=>({userId,slotIndex,seatId:'seat-'+slotIndex,reservedAtUtc:new Date(0).toISOString()}));
 return s;
}
class Visual implements RosterVisual {
 opacity=1;destroyed=0;
 constructor(public user:Participant,public profile?:AvatarProfile){}
 update(user:Participant,profile?:AvatarProfile):void{this.user=user;this.profile=profile;}
 dispose():void{this.destroyed++;}
}
test('waiting and historical participants never allocate graphics; departures retire after fade',()=>{
 const roster=new AvatarRoster((p,profile)=>new Visual(p,profile));
 roster.sync(state([person('1'),person('2'),person('3','absent')],['1','3']));
 expect([...roster.avatars.keys()]).toEqual(['1']);
 const first=roster.avatars.get('1')!;
 roster.sync(state([person('1','absent'),person('2')],['1','2']));
 expect(roster.avatars.size).toBe(2);roster.pruneFaded();expect(first.destroyed).toBe(0);
 first.opacity=.004;roster.pruneFaded();expect(first.destroyed).toBe(1);
 roster.sync(state([person('1','absent'),person('2')],['1','2']));expect(roster.avatars.size).toBe(1);
 roster.sync(state([person('1'),person('2')],['1','2']));expect(roster.avatars.get('1')).not.toBe(first);
 const second=roster.avatars.get('2')!;roster.dispose();roster.dispose();expect(second.destroyed).toBe(1);
});
test('seat release and server epoch replacement retire the original owner',()=>{
 const roster=new AvatarRoster(p=>new Visual(p));
 const s=state([person('1')],['1']);roster.sync(s);const first=roster.avatars.get('1')!;
 roster.sync({...s,session:{...s.session,reservations:[]}});expect(first.destroyed).toBe(1);
 roster.sync(s);const second=roster.avatars.get('1')!;
 roster.sync({...s,serverEpoch:'restart'});expect(second.destroyed).toBe(1);
 expect(roster.avatars.get('1')).not.toBe(second);roster.dispose();
});
