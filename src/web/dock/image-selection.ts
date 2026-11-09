export interface ImageFit {x:number;y:number;w:number;h:number}
export function fitImage(width:number,height:number,canvasWidth:number,canvasHeight:number,padding=16):ImageFit {
 const scale=Math.min((canvasWidth-padding*2)/width,(canvasHeight-padding*2)/height);
 return {x:(canvasWidth-width*scale)/2,y:(canvasHeight-height*scale)/2,w:width*scale,h:height*scale};
}
export function imagePoint(clientX:number,clientY:number,bounds:{left:number;top:number;width:number;height:number},canvasWidth:number,canvasHeight:number,fit:ImageFit):{x:number;y:number}{
 const x=(clientX-bounds.left)*canvasWidth/bounds.width,y=(clientY-bounds.top)*canvasHeight/bounds.height;
 return {x:Math.max(0,Math.min(1,(x-fit.x)/fit.w)),y:Math.max(0,Math.min(1,(y-fit.y)/fit.h))};
}
