/** Read a command before entering the mutation queue. The length header is an
 * early rejection, not authority: the streamed bytes are the real limit. */
export async function boundedText(request:Request,limit:number):Promise<string>{
 const length=Number(request.headers.get('content-length')??0);
 if(length>limit)throw new Error('COMMAND_TOO_LARGE');
 if(!request.body)return '';
 const reader=request.body.getReader(),decoder=new TextDecoder();
 let bytes=0,text='';
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)return text+decoder.decode();
   bytes+=part.value.byteLength;
   if(bytes>limit){void reader.cancel().catch(()=>{});throw new Error('COMMAND_TOO_LARGE');}
   text+=decoder.decode(part.value,{stream:true});
  }
 }finally{reader.releaseLock();}
}
