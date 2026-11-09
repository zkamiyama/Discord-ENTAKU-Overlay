import {MAX_IMAGE_BYTES} from '../../assets/image.ts';
import type {StudioClient} from '../shared/client.ts';
/** Validate server limits before invoking the browser decoder. Ownership of a
 * successful bitmap transfers to the editor; every failure closes it here. */
export async function loadAvatarImage(client:StudioClient,file:File,visibleContent:boolean){
 if(file.size>MAX_IMAGE_BYTES)throw new Error('IMAGE_TOO_LARGE');
 const image=await client.importImage(file),bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width!==image.width||bitmap.height!==image.height)throw new Error('INVALID_IMAGE');
  if(visibleContent){
   const check=document.createElement('canvas');check.width=Math.min(256,bitmap.width);check.height=Math.max(1,Math.round(bitmap.height*check.width/bitmap.width));
   const context=check.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,0,0,check.width,check.height);
   if(!context.getImageData(0,0,check.width,check.height).data.some((v,i)=>i%4===3&&v>=128))throw new Error('EMPTY_AVATAR_IMAGE');
  }
  return {image,bitmap};
 }catch(error){bitmap.close();throw error;}
}
