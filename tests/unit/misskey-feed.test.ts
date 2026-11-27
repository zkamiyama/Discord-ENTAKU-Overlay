import {expect,test} from 'bun:test';
import {MisskeyFeed} from '../../src/misskey/feed.ts';
import {DEFAULT_MISSKEY_SETTINGS} from '../../src/misskey/settings.ts';
import {parseMisskeyState,type MisskeySettings} from '../../src/contracts/misskey.ts';

function fixture(patch:Partial<MisskeySettings>={}){
  let now=1_800_000_000_000;
  const settings={...DEFAULT_MISSKEY_SETTINGS,enabled:true,...patch};
  const feed=new MisskeyFeed(settings,()=>now);
  const note=(id:string,userId='user'+id,text=`場面${id}についての投稿です #NicoMiss`)=>({id,createdAt:new Date(now).toISOString(),visibility:'public',text,cw:null,files:[],user:{id:userId,username:'tester',name:'投稿者'+id,host:null}});
  return {feed,settings,note,advance(ms:number){now+=ms;feed.tick();},get now(){return now;}};
}

test('first accepted note is immediate; subsequent cards enter at most twice per second and expire',()=>{
  const f=fixture({lifetimeMs:5000});
  expect(f.feed.ingest(f.note('1'))).toBe(true);expect(f.feed.snapshot().cards).toHaveLength(1);
  f.feed.ingest(f.note('2'));f.feed.ingest(f.note('3'));expect(f.feed.snapshot()).toMatchObject({queued:2,accepted:3});
  f.advance(499);expect(f.feed.snapshot().cards).toHaveLength(1);
  f.advance(1);expect(f.feed.snapshot().cards).toHaveLength(2);
  f.advance(20_000);expect(f.feed.snapshot().cards).toHaveLength(1);expect(f.feed.snapshot().cards[0]?.id).toBe('3');
  f.advance(5000);expect(f.feed.snapshot().cards).toEqual([]);
  expect(parseMisskeyState(f.feed.snapshot())).not.toBeNull();
});

test('visible and queued notes share the user cap and a clear cannot evade the cooldown',()=>{
  const f=fixture({maxPerUser:2});
  f.feed.ingest(f.note('1','same'));f.feed.ingest(f.note('2','same'));expect(f.feed.snapshot().rejected['rate-limit']).toBe(1);
  f.advance(10_000);expect(f.feed.ingest(f.note('3','same'))).toBe(true);
  f.advance(10_000);expect(f.feed.ingest(f.note('4','same'))).toBe(false);expect(f.feed.snapshot().rejected['user-limit']).toBe(1);
  f.feed.clear();expect(f.feed.ingest(f.note('3','same'))).toBe(false);expect(f.feed.snapshot().rejected.duplicate).toBe(1);
  const g=fixture();g.feed.ingest(g.note('a','same'));g.feed.clear();expect(g.feed.ingest(g.note('b','same'))).toBe(false);
  expect(g.feed.snapshot().rejected['rate-limit']).toBe(1);
});

test('ID and normalized body deduplication survive deletion, clear and recovery, then expire',()=>{
  const f=fixture();
  const first=f.note('1','a','ＨＥＬＬＯ！ #NicoMiss');f.feed.ingest(first);f.feed.clear();
  expect(f.feed.ingest(first,'recovery')).toBe(false);
  expect(f.feed.ingest(f.note('2','b','hello #nicomiss'))).toBe(false);
  expect(f.feed.snapshot().rejected.duplicate).toBe(2);
  f.advance(600_001);expect(f.feed.ingest(f.note('3','c','hello #NicoMiss'))).toBe(true);
});

test('accepted cheers still obey content deduplication, user limits, cooldown and threat filtering',()=>{
  const f=fixture();
  expect(f.feed.ingest(f.note('1','a','w'.repeat(20)+' #NicoMiss'))).toBe(true);
  expect(f.feed.ingest(f.note('2','b','ｗ'.repeat(20)+' #NicoMiss'))).toBe(false);
  const cheer=f.note('3','a','きた'+'あ'.repeat(30)+'！ #NicoMiss');
  expect(f.feed.ingest(cheer)).toBe(false);
  expect(f.feed.snapshot().rejected).toMatchObject({duplicate:1,'user-limit':1});
  f.feed.clear();expect(f.feed.ingest(cheer)).toBe(false);
  expect(f.feed.ingest(f.note('4','c','きた'+'あ'.repeat(30)+'！殺してやる #NicoMiss'))).toBe(false);
  expect(f.feed.snapshot().rejected).toMatchObject({'rate-limit':1,'blocked-word':1});
  expect(f.feed.snapshot().rejected.repetition).toBeUndefined();
});

test('edits and deletions revoke visible and queued content, including deletion before recovery',()=>{
  const f=fixture();f.feed.ingest(f.note('1'));f.feed.ingest(f.note('2'));
  f.feed.update('1',{text:'殺してやる #NicoMiss'});f.feed.remove('2');f.feed.remove('3');
  expect(f.feed.snapshot().cards).toEqual([]);expect(f.feed.trackedNoteIds).toEqual([]);
  expect(f.feed.ingest(f.note('3'),'recovery')).toBe(false);expect(f.feed.snapshot().rejected.duplicate).toBe(1);
});

test('pause clears display and pending work, and resumes with new notes only',()=>{
  const f=fixture();f.feed.ingest(f.note('1'));f.feed.ingest(f.note('2'));f.feed.setPaused(true);
  expect(f.feed.snapshot()).toMatchObject({paused:true,cards:[],queued:0});
  expect(f.feed.ingest(f.note('3'))).toBe(false);expect(f.feed.snapshot().received).toBe(2);
  f.advance(1000);f.feed.setPaused(false);expect(f.feed.ingest(f.note('4'))).toBe(true);
  expect(f.feed.snapshot().cards.map(card=>card.id)).toEqual(['4']);
});

test('a late recovery response cannot restore notes from before resume and policy changes retain pause',()=>{
  const f=fixture(),old=f.note('old');
  f.feed.setPaused(true);f.feed.configure({...f.settings,maxCharacters:200});
  expect(f.feed.snapshot().paused).toBe(true);
  f.advance(1000);const during=f.note('during');f.advance(1000);f.feed.setPaused(false);
  expect(f.feed.ingest(old,'recovery')).toBe(false);expect(f.feed.ingest(during,'recovery')).toBe(false);
  expect(f.feed.snapshot().rejected['too-old']).toBe(2);
  expect(f.feed.ingest(f.note('new'))).toBe(true);
  f.feed.configure({...f.settings,hashtag:'AnotherTag'});
  expect(f.feed.ingest({...old,text:'別のタグ #AnotherTag'},'recovery')).toBe(true);
});

test('runtime reconfiguration rechecks policy by clearing active notes and keeps same-instance dedupe',()=>{
  const f=fixture();f.feed.ingest(f.note('1'));f.feed.configure({...f.settings,blockedWords:['場面']});
  expect(f.feed.trackedNoteIds).toEqual([]);expect(f.feed.ingest(f.note('2'))).toBe(false);
  expect(f.feed.snapshot().rejected['blocked-word']).toBe(1);
  f.feed.configure({...f.settings,includeHome:true});expect(f.feed.snapshot().includeHome).toBe(true);
  expect(f.feed.ingest(f.note('1'))).toBe(false);
  f.feed.configure({...f.settings,instanceUrl:'https://misskey.example.com'});expect(f.feed.ingest(f.note('1'))).toBe(true);
  expect(f.feed.snapshot().cards[0]?.url).toBe('https://misskey.example.com/notes/1');
  const before=f.feed.settings;expect(()=>f.feed.configure({...before,maxCards:31})).toThrow();expect(f.feed.settings).toEqual(before);
});

test('scope changes re-evaluate previous rejections while clear and edit tombstones survive policy changes',()=>{
  const f=fixture();
  const home={...f.note('home'),visibility:'home'};
  expect(f.feed.ingest(home)).toBe(false);
  f.feed.configure({...f.settings,includeHome:true});expect(f.feed.ingest(home,'recovery')).toBe(true);
  f.feed.clear();f.feed.configure({...f.settings,includeHome:true,maxCharacters:200});
  expect(f.feed.ingest(home,'recovery')).toBe(false);
  const remote={...f.note('remote'),user:{id:'remote-user',username:'remote',name:'リモート',host:'misskey.example.com'}};
  expect(f.feed.ingest(remote)).toBe(false);
  f.feed.configure({...f.settings,localOnly:false});expect(f.feed.ingest(remote,'recovery')).toBe(true);
  const other=f.note('other','other-user','別の配信を見ています #AnotherTag');
  expect(f.feed.ingest(other)).toBe(false);
  f.feed.configure({...f.settings,hashtag:'AnotherTag'});expect(f.feed.ingest(other,'recovery')).toBe(true);
  f.feed.update('other',{text:'変更済み'});f.feed.configure({...f.settings,hashtag:'AnotherTag',maxCharacters:200});
  expect(f.feed.ingest(other,'recovery')).toBe(false);
});

test('queue and active cards remain bounded and do not exceed 90 tracked notes under sustained input',()=>{
  const f=fixture({lifetimeMs:120_000});
  for(let i=0;i<150;i++){f.feed.ingest(f.note(String(i)));f.advance(50);}
  const first=f.feed.snapshot();expect(first.cards.length).toBeLessThanOrEqual(30);expect(first.queued).toBeLessThanOrEqual(60);
  expect(first.rejected['queue-full']).toBeGreaterThan(0);expect(f.feed.trackedNoteIds.length).toBeLessThanOrEqual(90);
  for(let i=150;i<300;i++){f.feed.ingest(f.note(String(i)));f.advance(500);expect(f.feed.trackedNoteIds.length).toBeLessThanOrEqual(90);}
  expect(f.feed.snapshot().cards).toHaveLength(30);expect(new Set(f.feed.snapshot().cards.map(card=>card.slot)).size).toBe(30);
});

test('a small display cap rotates throughout all 30 spatial slots instead of occupying one corner',()=>{
  const f=fixture({maxCards:1,lifetimeMs:5000}),slots:number[]=[];
  for(let i=0;i<35;i++){f.feed.ingest(f.note(String(i)));slots.push(f.feed.snapshot().cards[0]!.slot);f.advance(5001);}
  expect(new Set(slots).size).toBe(30);expect(slots.slice(0,30)).toEqual(Array.from({length:30},(_,i)=>i));
});

test('stale recovery and stale queued notes cannot appear; recovery does not pretend to be a live event',()=>{
  const f=fixture({maxCards:1,lifetimeMs:120_000});
  f.feed.ingest(f.note('1'),'recovery');expect(f.feed.snapshot().lastEventAt).toBeNull();
  f.feed.ingest(f.note('2'),'recovery');f.advance(120_001);
  expect(f.feed.snapshot()).toMatchObject({cards:[],queued:0,rejected:{'too-old':1}});
  f.feed.ingest({...f.note('3'),createdAt:new Date(f.now-130_000).toISOString()},'recovery');
  expect(f.feed.snapshot().rejected['too-old']).toBe(2);
});

test('a bounded recovery page reviews its tail without consuming the live input budget',()=>{
  const f=fixture();
  for(let i=0;i<100;i++)f.feed.ingest({...f.note(String(i)),visibility:i<60?'home':'public'},'recovery');
  expect(f.feed.snapshot()).toMatchObject({received:100,accepted:40,queued:39,rejected:{'not-public':60}});
  expect(f.feed.snapshot().rejected['rate-limit']).toBeUndefined();
  expect(f.feed.ingest(f.note('live'))).toBe(true);expect(f.feed.snapshot().lastEventAt).toBe(f.now);
});

test('statistics notifications are coalesced during flood and bounded ingestion limits parsing work',()=>{
  const f=fixture();let notifications=0;f.feed.observe(()=>notifications++);
  for(let i=0;i<1000;i++)f.feed.ingest(f.note(String(i)));
  expect(notifications).toBe(1);expect(f.feed.snapshot().received).toBe(1000);
  expect(f.feed.snapshot().rejected['rate-limit']).toBeGreaterThan(900);
  f.advance(249);expect(notifications).toBe(1);f.advance(1);expect(notifications).toBe(2);
  for(let i=0;i<1000;i++)f.feed.ingest(f.note('next'+i));expect(notifications).toBe(2);
  f.advance(250);expect(notifications).toBe(3);
});

test('observable state and settings cannot mutate the owner; an observer failure cannot stop the feed',()=>{
  const f=fixture();let observed=0;
  f.feed.observe(()=>{throw Error('observer failed');});f.feed.observe(state=>{observed++;state.cards.length=0;});
  expect(()=>f.feed.ingest(f.note('1'))).not.toThrow();expect(observed).toBe(1);expect(f.feed.snapshot().cards).toHaveLength(1);
  const settings=f.feed.settings;settings.blockedUsers.push('user1');settings.enabled=false;
  expect(f.feed.settings).toEqual(f.settings);
  const snapshot=f.feed.snapshot();snapshot.cards[0]!.text='changed';expect(f.feed.snapshot().cards[0]!.text).not.toBe('changed');
});

test('connection reporting is sanitized and disposal prevents late activity',()=>{
  const f=fixture();f.feed.setConnection('reconnecting','MISSKEY_NETWORK_FAILED',f.now+1000);f.feed.setConnection('reconnecting','MISSKEY_NETWORK_FAILED',f.now+1000);
  expect(f.feed.snapshot()).toMatchObject({status:'reconnecting',reconnects:1,errorCode:'MISSKEY_NETWORK_FAILED'});
  f.feed.setConnection('error','secret https://bad.invalid/?token=private',NaN);expect(f.feed.snapshot()).toMatchObject({errorCode:null,retryAt:null});
  f.feed.ingest(f.note('1'));f.feed.dispose();f.feed.ingest(f.note('2'));f.feed.tick();f.feed.setConnection('live');
  expect(f.feed.snapshot()).toMatchObject({cards:[],queued:0,status:'disabled'});expect(f.feed.trackedNoteIds).toEqual([]);
});

test('many rejected users and note IDs leave no unbounded retained payload',()=>{
  const f=fixture();
  for(let i=0;i<12_000;i++){f.feed.ingest(f.note(String(i)));if(i%20===0)f.advance(500);}
  expect(f.feed.trackedNoteIds.length).toBeLessThanOrEqual(90);
  // Inspect all retained collections, not a process-wide memory reading affected
  // by the test runner's own allocations. Raw notes must never be retained.
  for(const value of Object.values(f.feed)){
    if(value instanceof Map)expect(value.size).toBeLessThanOrEqual(4096);
    if(Array.isArray(value))expect(value.length).toBeLessThanOrEqual(60);
  }
  f.advance(600_001);f.feed.clear();
  for(const value of Object.values(f.feed))if(value instanceof Map)expect(value.size).toBe(0);
});
