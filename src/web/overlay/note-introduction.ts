import type {IntroducedNote,NoteIntroductionState} from '../../contracts/note-introduction.ts';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string):HTMLElementTagNameMap[K]=>{
 const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;
};
type Phase='hidden'|'preparing'|'entering'|'shown'|'leaving';

/** One screen-space article, outside the single/split WebGL pipelines. */
export class NoteIntroductionOverlay {
 private readonly host=element('article','note-introduction-position');
 private readonly surface=element('div','note-introduction-card');
 private readonly monogram=element('span','note-introduction-monogram');
 private readonly author=element('strong','note-introduction-author');
 private readonly source=element('span','note-introduction-source');
 private readonly body=element('p','note-introduction-body');
 private readonly introducer=element('span','note-introduction-introducer');
 private readonly attachments=element('span','note-introduction-attachments');
 private readonly motion=matchMedia('(prefers-reduced-motion: reduce)');
 private observer?:ResizeObserver;
 private animation?:Animation;
 private displayed:IntroducedNote|null=null;
 private desired:IntroducedNote|null=null;
 private phase:Phase='hidden';
 private disposed=false;
 private fitFrame=0;
 private fitSequence=0;
 private fitYield?:{frame:number;resume:(active:boolean)=>void};
 private fits=0;
 private readonly resize=()=>this.scheduleFit();
 private readonly motionChanged=()=>{if(this.motion.matches&&this.animation)try{this.animation.finish();}catch{/* It may already have been cancelled. */}};

 constructor(layer:HTMLElement){
  this.host.id='note-introduction';this.host.hidden=true;this.host.setAttribute('aria-label','紹介ノート');
  const header=element('header','note-introduction-header'),identity=element('div','note-introduction-identity');
  identity.append(this.author,this.source);this.monogram.setAttribute('aria-hidden','true');
  const badge=element('span','note-introduction-badge','Misskey');header.append(this.monogram,identity,badge);
  const footer=element('footer','note-introduction-footer'),by=element('div','note-introduction-by');
  by.append(element('span','note-introduction-by-label','VCから紹介'),this.introducer);footer.append(by,this.attachments);
  this.author.dir=this.body.dir=this.introducer.dir='auto';this.body.id='note-introduction-text';
  this.host.setAttribute('aria-describedby',this.body.id);this.surface.append(header,this.body,footer);this.host.append(this.surface);layer.append(this.host);
  this.setPhase('hidden');
  if(typeof ResizeObserver!=='undefined'){
   // Observe the viewport, not the content whose font and height we change.
   this.observer=new ResizeObserver(this.resize);this.observer.observe(document.documentElement);
  }
  window.addEventListener('resize',this.resize);this.motion.addEventListener('change',this.motionChanged);
  void document.fonts.ready.then(this.resize).catch(()=>{});
 }

 update(state:NoteIntroductionState|null):void {
  if(this.disposed)return;
  // Transport loss and rejected state must remove stale broadcast content now.
  if(state===null){this.clear();return;}
  this.desired=state.card;
  if(this.phase==='leaving')return;
  if(this.displayed?.presentationId===this.desired?.presentationId)return;
  if(this.phase==='preparing'){this.stopFit();this.hide();if(this.desired)this.enter();return;}
  if(this.displayed)this.leave();else if(this.desired)this.enter();
 }
 private setPhase(phase:Phase):void {this.phase=phase;this.host.dataset.phase=phase;}
 private enter():void {
  const note=this.desired;if(!note||this.disposed)return;
  this.displayed=note;this.host.dataset.presentationId=String(note.presentationId);this.host.dataset.noteId=note.id;
  this.author.textContent=note.authorName||note.username;
  const segment=new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(note.authorName||note.username)[Symbol.iterator]().next().value;
  this.monogram.textContent=segment?.segment??'•';
  this.source.textContent=`@${note.username}${note.userHost?'@'+note.userHost:''} · ${new URL(note.instanceUrl).host}`;
  this.source.title=note.url;this.introducer.textContent=note.introducedBy||'VC';
  this.body.textContent=note.text;this.body.hidden=!note.text;
  this.attachments.textContent=`添付 ${note.attachmentCount}件`;this.attachments.hidden=note.attachmentCount===0;
  this.host.hidden=false;this.host.style.visibility='hidden';this.setPhase('preparing');void this.prepareEntrance();
 }
 private async prepareEntrance():Promise<void> {
  if(!await this.fit()||this.disposed||this.phase!=='preparing')return;
  this.host.style.visibility='';this.setPhase('entering');
  this.animate({transform:this.offscreen(),opacity:'0'},{transform:'translateY(0)',opacity:'1'},360,()=>{
   this.setPhase('shown');
   if(this.desired?.presentationId!==this.displayed?.presentationId)this.leave();
  });
 }
 private leave():void {
  if(this.phase==='leaving'||!this.displayed)return;
  this.stopFit();
  if(this.host.style.visibility==='hidden'){this.animation?.cancel();this.animation=undefined;this.hide();if(this.desired)this.enter();return;}
  const current=getComputedStyle(this.host),from={transform:current.transform,opacity:current.opacity};
  this.setPhase('leaving');
  this.animate(from,{transform:this.offscreen(),opacity:'0'},220,()=>{
   this.hide();if(this.desired)this.enter();
  });
 }
 private offscreen():string {return `translateY(calc(100% + ${Math.max(48,innerHeight*.1)}px))`;}
 private animate(from:{transform:string;opacity:string},to:{transform:string;opacity:string},duration:number,done:()=>void):void {
  this.animation?.cancel();this.animation=undefined;
  if(this.motion.matches){Object.assign(this.host.style,to);done();return;}
  const animation=this.host.animate([from,to],{duration,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});this.animation=animation;
  void animation.finished.then(()=>{
   if(this.disposed||this.animation!==animation)return;
   Object.assign(this.host.style,to);this.animation=undefined;animation.cancel();done();
  }).catch(()=>{/* Replaced animations reject finished with AbortError. */});
 }
 private hide():void {
  this.displayed=null;this.host.hidden=true;this.setPhase('hidden');
  delete this.host.dataset.presentationId;delete this.host.dataset.noteId;
  this.body.textContent='';this.author.textContent='';this.source.textContent='';this.source.removeAttribute('title');this.introducer.textContent='';this.monogram.textContent='';this.attachments.textContent='';
 }
 private clear():void {
  this.desired=null;this.animation?.cancel();this.animation=undefined;
  this.stopFit();this.hide();
 }
 private stopFit():void {
  this.fitSequence++;cancelAnimationFrame(this.fitFrame);this.fitFrame=0;
  const pending=this.fitYield;this.fitYield=undefined;if(pending){cancelAnimationFrame(pending.frame);pending.resume(false);}
 }
 private yieldFit(sequence:number):Promise<boolean> {
  return new Promise(resolve=>{
   const frame=requestAnimationFrame(()=>{this.fitYield=undefined;resolve(!this.disposed&&sequence===this.fitSequence);});
   this.fitYield={frame,resume:resolve};
  });
 }
 private scheduleFit():void {
  if(this.disposed||!this.displayed||this.fitFrame)return;
  this.fitFrame=requestAnimationFrame(()=>{
   this.fitFrame=0;if(this.disposed||!this.displayed||this.phase==='leaving')return;
   if(this.phase==='preparing')void this.prepareEntrance();
   else void this.fit().then(active=>{if(active)this.host.style.visibility='';});
  });
 }
 /** Measure only when content, viewport or fonts change. Text stays intact. */
 private async fit():Promise<boolean> {
  if(!this.displayed||this.disposed)return false;
  this.stopFit();const sequence=this.fitSequence,cooperative=this.displayed.text.length>4096;
  const width=innerWidth*.8,budget=Math.max(.5,innerHeight*.5-1);
  this.host.style.visibility='hidden';
  this.surface.style.width='100%';this.surface.style.transform='';this.body.style.fontSize='';
  const base=parseFloat(getComputedStyle(this.body).fontSize),height=()=>this.surface.getBoundingClientRect().height;
  let font=base,scale=1;
  // Avoid first laying out tens of thousands of hard lines at the largest font.
  if(cooperative&&!this.body.hidden){this.body.style.fontSize='1px';font=1;}
  if((cooperative||height()>budget)&&!this.body.hidden){
   this.body.style.fontSize='1px';font=1;
   if(height()<=budget){
    let low=1,high=base;
    for(let i=0;i<8;i++){
     if(cooperative&&!await this.yieldFit(sequence))return false;
     const mid=(low+high)/2;this.body.style.fontSize=`${mid}px`;if(height()<=budget)low=mid;else high=mid;
    }
    font=low;this.body.style.fontSize=`${font}px`;
   }
  }
  // Explicit line breaks, enormous metadata, or a browser minimum font can
  // still exceed the budget. Scale the whole article; widen its layout so its
  // physical width remains 80vw. No line clamp, crop, ellipsis or text slicing.
  const natural=height();
  if(natural>budget){
   if(cooperative&&!await this.yieldFit(sequence))return false;
   scale=Math.min(1,budget/natural);this.surface.style.width=`${width/scale}px`;
  }
  const fittedHeight=height()*scale;this.surface.style.transform=scale===1?'':`scale(${scale})`;
  this.host.style.height=`${fittedHeight}px`;
  this.host.dataset.fitCount=String(++this.fits);this.host.dataset.fontSize=String(font*scale);this.host.dataset.scale=String(scale);
  return true;
 }
 dispose():void {
  if(this.disposed)return;this.clear();this.disposed=true;this.observer?.disconnect();
  window.removeEventListener('resize',this.resize);this.motion.removeEventListener('change',this.motionChanged);this.host.remove();
 }
}
