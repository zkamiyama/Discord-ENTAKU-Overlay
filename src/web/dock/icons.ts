/** Phosphor assets are bundled at build time; no icon font or remote CDN. */
export function icon(name:string):SVGSVGElement {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 256 256');svg.setAttribute('aria-hidden','true');svg.classList.add('icon');
 const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','/static/icons.svg#'+name);svg.append(use);return svg;
}
export function decorate(button:HTMLElement,name:string,label:string,showLabel=false):void {
 button.replaceChildren(icon(name));button.setAttribute('aria-label',label);button.title=label;
 if(showLabel){const span=document.createElement('span');span.textContent=label;button.append(span);}
}
export function decorateShell():void {
 for(const e of document.querySelectorAll<HTMLElement>('[data-icon]'))decorate(e,e.dataset.icon!,e.getAttribute('aria-label')??e.textContent??'',e.dataset.label==='true');
}
