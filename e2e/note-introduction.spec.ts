import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import type {APIRequestContext} from '@playwright/test';
import type {IntroducedNote,NoteIntroductionState} from '../src/contracts/note-introduction.ts';
import type {NoteIntroductionOverlay} from '../src/web/overlay/note-introduction.ts';
import {expect,test,type Page} from './fixtures.ts';
test.use({chatFixture:true,noteIntroductionFixture:true});
const control='http://127.0.0.1:31342/';
const post=(request:APIRequestContext,id:string,note:string)=>request.post('http://127.0.0.1:31340/',{data:{cmd:'DISPATCH',evt:'MESSAGE_CREATE',data:{channel_id:'200',message:{id,author:{id:'42',username:'紹介する人'},content:`https://otomad.site/notes/${note}`,timestamp:new Date().toISOString()}}}});
const note=(id:number,text:string):IntroducedNote=>({presentationId:id,id:'note'+id,url:'https://otomad.site/notes/note'+id,instanceUrl:'https://otomad.site',userId:'author',username:'creator',authorName:'映像実験室',userHost:null,text,createdAt:'2026-11-28T00:00:00.000Z',attachmentCount:2,sourceMessageId:String(id),sourceChannelId:'200',introducedBy:'紹介する人'});
const state=(id:number,text:string):NoteIntroductionState=>({revision:id,status:'showing',card:note(id,text),pendingUrl:null,errorCode:null,retryAt:null});
type Probe={introductionOverlay:NoteIntroductionOverlay};
let probe='';
test.beforeAll(()=>{
 execFileSync('bun',['build','src/web/overlay/note-introduction.ts','--target=browser','--format=esm','--outfile=.work/note-introduction-probe.js']);
 probe=readFileSync('.work/note-introduction-probe.js','utf8');
});
async function openProbe(page:Page):Promise<void>{
 await page.route('**/note-introduction-layout-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/overlay.css"></head><body><section id="note-introduction-layer"></section><script type="module">import {NoteIntroductionOverlay} from "/static/note-introduction-probe.js";window.introductionOverlay=new NoteIntroductionOverlay(document.querySelector("#note-introduction-layer"));</script></body></html>'}));
 await page.route('**/static/note-introduction-probe.js',route=>route.fulfill({contentType:'text/javascript',body:probe}));
 await page.goto('/note-introduction-layout-probe');await page.waitForFunction(()=>!!(window as unknown as Probe).introductionOverlay);
}
async function show(page:Page,id:number,text:string):Promise<void>{
 await page.evaluate(value=>(window as unknown as Probe).introductionOverlay.update(value),state(id,text));
 await expect(page.locator('#note-introduction')).toHaveAttribute('data-presentation-id',String(id));
 await expect(page.locator('#note-introduction')).toHaveAttribute('data-phase','shown');
}
async function dimensions(page:Page){
 return page.locator('#note-introduction').evaluate(article=>{
  const surface=article.querySelector<HTMLElement>('.note-introduction-card')!,body=article.querySelector<HTMLElement>('.note-introduction-body')!;
  const a=article.getBoundingClientRect(),s=surface.getBoundingClientRect(),b=body.getBoundingClientRect();
  return {x:a.x,y:a.y,width:a.width,height:a.height,bottom:a.bottom,surfaceWidth:s.width,surfaceHeight:s.height,bodyBottom:b.bottom,overflowX:surface.scrollWidth-surface.clientWidth,
   fontSize:Number((article as HTMLElement).dataset.fontSize),scale:Number((article as HTMLElement).dataset.scale),fitCount:(article as HTMLElement).dataset.fitCount};
 });
}

test('a VC note stays in one viewport card across cameras and split, without fetching media, and Dock can dismiss it',async({page,context,request})=>{
 test.setTimeout(90000);const errors:string[]=[],external:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));await page.goto('/dock');await expect(page.locator('#vc-chat-status')).toContainText('受信中');
 const overlay=await context.newPage();overlay.on('pageerror',error=>errors.push(error.message));
 overlay.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:31339/'))external.push(r.url());});
 await overlay.goto('/overlay');await expect(overlay.locator('#scene')).toHaveAttribute('data-studio-status','READY');
 const text='音と映像が重なる、この瞬間が好き。次の展開も楽しみ！';
 await request.post(control,{data:{action:'seed',id:'short',note:{id:'short',user:{id:'author',username:'creator',name:'映像実験室',avatarUrl:'https://external.invalid/avatar.png'},visibility:'public',cw:null,
  files:[{type:'image/png',url:'https://external.invalid/image.png'},{type:'video/mp4',url:'https://external.invalid/movie.mp4'}],createdAt:'2026-11-28T00:00:00Z',text}}});
 await post(request,'1','short');const article=overlay.locator('#note-introduction');await expect(article).toHaveAttribute('data-phase','shown');
 await expect(overlay.locator('#note-introduction-text')).toHaveText(text);await expect(article.locator('.note-introduction-author')).toHaveText('映像実験室');
 await expect(article.locator('.note-introduction-source')).toContainText('otomad.site');await expect(article.locator('.note-introduction-introducer')).toHaveText('紹介する人');
 await expect(article.locator('.note-introduction-attachments')).toHaveText('添付 2件');await expect(article.locator('img,video,iframe')).toHaveCount(0);
 const wide=await dimensions(overlay);expect(wide.width).toBeCloseTo(1280*.8,1);expect(wide.height).toBeLessThan(720*.4);
 await overlay.screenshot({path:'.work/note-introduction-overlay.png',omitBackground:true});
 const people=page.locator('.person');for(const index of [1,2])await people.nth(index).getByRole('button',{name:'発話 ON',exact:true}).click();
 await expect(overlay.locator('#scene')).toHaveAttribute('data-split-count','2',{timeout:20000});
 const split=await dimensions(overlay);expect(split.x).toBeCloseTo(wide.x,2);expect(split.y).toBeCloseTo(wide.y,2);expect(split.width).toBeCloseTo(wide.width,2);expect(split.fitCount).toBe(wide.fitCount);
 await overlay.screenshot({path:'.work/note-introduction-split.png',omitBackground:true});
 await people.nth(0).getByRole('button',{name:'この人を撮る',exact:true}).click();await expect(overlay.locator('#scene')).toHaveAttribute('data-split-count','1');
 const single=await dimensions(overlay);expect(single.x).toBeCloseTo(wide.x,2);expect(single.y).toBeCloseTo(wide.y,2);expect(single.fitCount).toBe(wide.fitCount);
 await page.locator('#note-introduction-dismiss').click();await expect(article).toBeHidden();await expect(page.locator('#note-introduction-current')).toBeHidden();
 // The fixture ignores abort: an obsolete HTTP response must never return on air.
 await request.post(control,{data:{action:'seed',id:'late',text:'古い応答',delayMs:2200}});await post(request,'2','late');
 await expect(page.locator('#note-introduction-pending')).toContainText('/late');
 await request.post(control,{data:{action:'seed',id:'latest',text:'最後に紹介したノート'}});await post(request,'3','latest');
 await expect(article).toHaveAttribute('data-note-id','latest');await expect(article).toHaveAttribute('data-phase','shown');
 await overlay.waitForTimeout(2300);await expect(overlay.locator('#note-introduction-text')).toHaveText('最後に紹介したノート');
 await request.post('http://127.0.0.1:31340/',{data:{action:'disconnect'}});await expect(article).toBeHidden();
 expect(await overlay.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('intrinsic short cards and complete long text fit the same 80vw and 50vh bounds after resizing',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await openProbe(page);
 const cases=[['short','短いノートです。'],['japanese','音と映像が重なる、この瞬間が好き。'.repeat(600)],['url','https://example.com/'+'abcdefgh'.repeat(4000)],
  ['emoji','🎨👨‍👩‍👦‍👦👍🏽✨'.repeat(1400).slice(0,32768)],['breaks','先頭\n'+'\n'.repeat(32750)+'末尾まで'],['spaces',' \t'.repeat(12000)+'末尾まで']] as const;
 let id=10;
 for(const [width,height] of [[1280,720],[390,844]] as const){
  await page.setViewportSize({width,height});let shortHeight=0,baseFont=0;
  for(const [name,text] of cases){
   await show(page,++id,text);expect(await page.locator('#note-introduction-text').textContent()).toBe(text);
   const bounds=await dimensions(page);expect(bounds.width).toBeCloseTo(width*.8,1);expect(bounds.surfaceWidth).toBeCloseTo(width*.8,1);
   expect(bounds.height).toBeLessThanOrEqual(height*.5);expect(bounds.surfaceHeight).toBeLessThanOrEqual(height*.5);
   expect(bounds.overflowX).toBeLessThanOrEqual(1);expect(bounds.bottom).toBeLessThan(height);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.bodyBottom).toBeLessThanOrEqual(bounds.bottom+1);
   if(name==='short'){shortHeight=bounds.height;baseFont=bounds.fontSize;await page.screenshot({path:`.work/note-introduction-short-${width}.png`,omitBackground:true});}
   else{expect(bounds.height).toBeGreaterThan(shortHeight);expect(bounds.fontSize).toBeLessThan(baseFont);}
  }
 }
 await page.evaluate(()=>document.fonts.ready);await page.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});
 const fitted=(await dimensions(page)).fitCount;await page.evaluate(async()=>{for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);});
 expect((await dimensions(page)).fitCount).toBe(fitted);expect(errors).toEqual([]);
});

test('replacement animations and cancelled fitting only reveal the newest card',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await openProbe(page);await show(page,100,'最初のノート');
 await page.evaluate(([first,latest])=>{const overlay=(window as unknown as Probe).introductionOverlay;overlay.update(first!);overlay.update(latest!);},[state(101,'中間のノート'),state(102,'最後のノート')]);
 await expect(page.locator('#note-introduction')).toHaveAttribute('data-phase','leaving');
 await expect(page.locator('#note-introduction')).toHaveAttribute('data-presentation-id','102');await expect(page.locator('#note-introduction')).toHaveAttribute('data-phase','shown');
 await expect(page.locator('.note-introduction-card')).toHaveCount(1);await expect(page.locator('#note-introduction-text')).toHaveText('最後のノート');
 const literal='<img src="https://external.invalid/a" onerror="alert(1)"> そのままの文字';
 await page.evaluate(([large,latest])=>{const overlay=(window as unknown as Probe).introductionOverlay;overlay.update(null);overlay.update(large!);overlay.update(latest!);},[state(103,'\n'.repeat(32000)+'長文'),state(104,literal)]);
 await expect(page.locator('#note-introduction')).toHaveAttribute('data-presentation-id','104');await expect(page.locator('#note-introduction')).toHaveAttribute('data-phase','shown');
 await expect(page.locator('#note-introduction-text')).toHaveText(literal);await expect(page.locator('#note-introduction img')).toHaveCount(0);
 await page.evaluate(value=>{const overlay=(window as unknown as Probe).introductionOverlay;overlay.update(value);overlay.update(null);},state(105,'終了した紹介'));
 await expect(page.locator('#note-introduction')).toBeHidden();await expect(page.locator('#note-introduction-text')).toBeEmpty();
 await page.evaluate(()=>(window as unknown as Probe).introductionOverlay.dispose());await expect(page.locator('#note-introduction')).toHaveCount(0);
 expect(errors).toEqual([]);
});
