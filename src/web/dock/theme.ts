export function installTheme():void {
 const select=document.getElementById('theme') as HTMLSelectElement;
 let choice='system';try{const saved=localStorage.getItem('entaku-theme');if(saved==='dark'||saved==='light')choice=saved;}catch{}
 const dark=matchMedia('(prefers-color-scheme: dark)'),light=matchMedia('(prefers-color-scheme: light)');
 const apply=()=>{document.documentElement.dataset.theme=choice==='system'?(light.matches?'light':'dark'):choice;};
 select.value=choice;select.addEventListener('change',()=>{choice=select.value;try{if(choice==='system')localStorage.removeItem('entaku-theme');else localStorage.setItem('entaku-theme',choice);}catch{}apply();});
 dark.addEventListener('change',apply);light.addEventListener('change',apply);apply();
}
