/** Read a command before entering the mutation queue. The length header is an
 * early rejection, not authority: the streamed bytes are the real limit. */
export async function boundedText(request:Request,limit:number):Promise<string>{
 if(!Number.isSafeInteger(limit)||limit<0)throw new Error('INVALID_BODY_LIMIT');
 request.signal.throwIfAborted();
 const length=Number(request.headers.get('content-length')??0);
 if(length>limit){void request.body?.cancel().catch(()=>{});throw new Error('COMMAND_TOO_LARGE');}
 if(!request.body)return '';
 const reader=request.body.getReader(),decoder=new TextDecoder();
 const abort=()=>{void reader.cancel(request.signal.reason).catch(()=>{});};
 request.signal.addEventListener('abort',abort,{once:true});
 let bytes=0,text='';
 try{
  for(;;){
   const part=await reader.read();
   request.signal.throwIfAborted();
   if(part.done)return text+decoder.decode();
   bytes+=part.value.byteLength;
   if(bytes>limit){void reader.cancel().catch(()=>{});throw new Error('COMMAND_TOO_LARGE');}
   text+=decoder.decode(part.value,{stream:true});
  }
 }finally{request.signal.removeEventListener('abort',abort);reader.releaseLock();}
}
