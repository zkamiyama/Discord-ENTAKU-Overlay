/** One non-overlapping task, with no recurring timer while a Dock is hidden. */
export function pollVisible(task:()=>void|Promise<void>,intervalMs:number):()=>void {
 let timer:ReturnType<typeof setTimeout>|undefined,busy=false,stopped=false;
 const run=async()=>{
  if(stopped||busy||document.hidden)return;
  busy=true;
  try{await task();}finally{busy=false;if(!stopped&&!document.hidden)timer=setTimeout(()=>void run(),intervalMs);}
 };
 const visibility=()=>{clearTimeout(timer);if(!document.hidden)void run();};
 document.addEventListener('visibilitychange',visibility);void run();
 const dispose=()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
 window.addEventListener('pagehide',dispose,{once:true});return dispose;
}
