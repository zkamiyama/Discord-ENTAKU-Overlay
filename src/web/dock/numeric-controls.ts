/** Keep the native number input (validation, precision, existing listeners) and
 * pair it with a small range control. Commit on release, not on every GPU frame. */
const pairs=new Map<HTMLInputElement,HTMLInputElement>();
export function numericEditing(input:Element):boolean {
 const box=input.closest('.numeric-control');
 return input===document.activeElement||!!box?.contains(document.activeElement)||box?.querySelector<HTMLInputElement>('input[type=range]')?.dataset.editing==='true';
}
export function syncNumericControls():void {
 for(const [number,range]of pairs){
  if(!number.isConnected){pairs.delete(number);continue;}
  range.disabled=number.disabled;
  if(document.activeElement===range)continue;
  const value=Number(number.value);if(!Number.isFinite(value)||number.value==='')continue;
  range.value=range.dataset.log==='true'?String((Math.log2(Math.max(Number(number.min),value))-Math.log2(Number(number.min)))/(Math.log2(Number(number.max))-Math.log2(Number(number.min)))*1000):String(value);
  range.setAttribute('aria-valuetext',number.value);
 }
}
export function installNumericControls():void {
 const install=()=>{
  for(const number of document.querySelectorAll<HTMLInputElement>('input[type=number]')){
   if(pairs.has(number))continue;
   const label=number.closest('label')?.textContent?.trim()??number.id;
   const box=document.createElement('span');box.className='numeric-control';number.before(box);box.append(number);
   const range=document.createElement('input');range.type='range';range.id=number.id+'-slider';range.setAttribute('aria-label',label+' スライダー');
   range.min=number.min||(/(?:sx|sy|sz)$/.test(number.id)?'.01':'-100');range.max=number.max||(/(?:sx|sy|sz)$/.test(number.id)?'20':/yaw/.test(number.id)?'360':'100');
   if(/yaw/.test(number.id)&&!number.min)range.min='-360';
   range.step=number.step&&number.step!=='any'?number.step:'.1';
   if(number.id==='exposure-manual'){range.dataset.log='true';range.min='0';range.max='1000';range.step='1';}
   let commit:ReturnType<typeof setTimeout>|undefined;
   range.addEventListener('input',()=>{
    clearTimeout(commit);range.dataset.editing='true';
    const value=range.dataset.log==='true'?2**(Math.log2(Number(number.min))+Number(range.value)/1000*(Math.log2(Number(number.max))-Math.log2(Number(number.min)))):Number(range.value);
    number.value=String(Number(value.toPrecision(8)));range.setAttribute('aria-valuetext',number.value);
    number.dispatchEvent(new Event('input',{bubbles:true}));
   });
   range.addEventListener('change',()=>{clearTimeout(commit);commit=setTimeout(()=>{range.dataset.editing='false';number.dispatchEvent(new Event('change',{bubbles:true}));},150);});
   number.addEventListener('input',syncNumericControls);number.addEventListener('change',syncNumericControls);
   box.prepend(range);pairs.set(number,range);
  }
  syncNumericControls();
 };
 install();
 // State application and avatar edits explicitly synchronize script-assigned values.
}
