export const NAMEPLATE_MAX_STRETCH=1.1;
export function nameGraphemes(value:string):string[]{
 const text=value||'—';return [...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)].map(part=>part.segment);
}
/** Keep glyph height, bound widening, use tracking for short names. No truncation or lower compression cap. */
export function layoutNameGlyphs(widths:readonly number[],available:number,maxStretch=NAMEPLATE_MAX_STRETCH):{scaleX:number;gap:number;positions:number[]}{
 if(!widths.length||widths.some(w=>!Number.isFinite(w)||w<0)||!Number.isFinite(available)||available<=0||!Number.isFinite(maxStretch)||maxStretch<=0)throw new Error('INVALID_NAME_METRICS');
 const sum=widths.reduce((a,b)=>a+b,0),scaleX=Math.min(maxStretch,available/Math.max(1,sum));
 const gap=widths.length>1?Math.max(0,(available-sum*scaleX)/(widths.length-1)):0;
 let cursor=widths.length===1?(available-sum*scaleX)/2:0;
 const positions=widths.map(w=>{const x=cursor;cursor+=w*scaleX+gap;return x;});return {scaleX,gap,positions};
}
