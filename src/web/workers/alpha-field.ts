import { createDistanceField } from '../../assets/alpha-distance.ts';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer:Transferable[])=>void};
scope.onmessage=event=>{
  try{
    const {alpha,width,height,spread}=event.data as {alpha:Uint8Array;width:number;height:number;spread?:number};
    const field=createDistanceField(alpha,width,height,spread);
    scope.postMessage({field},[field.data.buffer as ArrayBuffer]);
  }catch{scope.postMessage({error:'ALPHA_FIELD_FAILED'},[]);}
};
