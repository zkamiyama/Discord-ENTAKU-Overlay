/** Close a successfully decoded image when its companion fails; Promise.all alone leaks it. */
export async function loadImagePair<T extends {close():void}>(front:Promise<T>,back?:Promise<T>):Promise<[T,T|undefined]>{
  const [a,b]=await Promise.allSettled([front,back??Promise.resolve(undefined)] as const);
  if(a.status==='rejected'||b.status==='rejected'){
    const owned=new Set<T>();
    if(a.status==='fulfilled')owned.add(a.value);
    if(b.status==='fulfilled'&&b.value)owned.add(b.value);
    for(const image of owned)image.close();
    throw a.status==='rejected'?a.reason:b.status==='rejected'?b.reason:new Error('IMAGE_PAIR_FAILED');
  }
  return [a.value,b.value];
}
