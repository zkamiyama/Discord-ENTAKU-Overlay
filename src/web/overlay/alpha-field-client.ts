import type { createDistanceField } from '../../assets/alpha-distance.ts';
type Field=ReturnType<typeof createDistanceField>;
let queue:Promise<unknown>=Promise.resolve();
/** Serial workers keep image preparation off the render thread and bound peak memory. */
export function alphaField(alpha:Uint8Array,width:number,height:number):Promise<Field>{
  const result=queue.then(()=>new Promise<Field>((resolve,reject)=>{
    const worker=new Worker('/static/avatar-field.js',{type:'module'});
    const cleanup=()=>{clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{cleanup();reject(new Error('ALPHA_FIELD_TIMEOUT'));},15000);
    worker.onmessage=e=>{cleanup();if(e.data.error)reject(new Error('ALPHA_FIELD_FAILED'));else resolve(e.data.field as Field);};
    worker.onerror=()=>{cleanup();reject(new Error('ALPHA_FIELD_FAILED'));};
    worker.postMessage({alpha,width,height},[alpha.buffer as ArrayBuffer]);
  }));
  queue=result.catch(()=>{});return result;
}
