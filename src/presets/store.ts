import {mkdir,readdir,lstat,readFile,writeFile,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {presetFilename,validatePreset,type ParameterPreset} from './schema.ts';
export interface PresetEntry {name:string;valid:boolean;error?:string}
export class PresetStore {
 private memory=new Map<string,ParameterPreset>();
 private index=new Map<string,{stamp:string;entry:PresetEntry}>();
 constructor(private directory:string|null=null){}
 private async root():Promise<string>{const root=join(this.directory!,'presets');await mkdir(root,{recursive:true,mode:0o700});return root;}
 async list():Promise<PresetEntry[]> {
  const names=this.directory?(await readdir(await this.root())).filter(n=>/\.json$/i.test(n)):[...this.memory.keys()];
  if(names.length>256)throw new Error('PRESET_LIMIT');
  const entries:PresetEntry[]=[];
  const present=new Set(names);for(const name of this.index.keys())if(!present.has(name))this.index.delete(name);
  for(const name of names.sort((a,b)=>a.localeCompare(b,'ja'))){
   let stamp='';
   try{
    if(this.directory){const stat=await lstat(join(await this.root(),name));stamp=[stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,stat.isFile()].join(':');}
    const cached=this.index.get(name);if(this.directory&&cached?.stamp===stamp){entries.push({...cached.entry});continue;}
    await this.read(name);const entry={name,valid:true};entries.push(entry);if(this.directory)this.index.set(name,{stamp,entry});
   }catch(e){const entry={name,valid:false,error:e instanceof Error?e.message:'PRESET_READ_FAILED'};entries.push(entry);if(stamp)this.index.set(name,{stamp,entry});}
  }
  return entries;
 }
 async read(name:string):Promise<ParameterPreset> {
  if(typeof name!=='string'||! /\.json$/i.test(name)||presetFilename(name).toLowerCase()!==name.toLowerCase())throw new Error('PRESET_NAME_INVALID');
  if(!this.directory){const p=this.memory.get(name);if(!p)throw new Error('PRESET_NOT_FOUND');return structuredClone(p);}
  try {
   const path=join(await this.root(),name),info=await lstat(path);
   if(!info.isFile()||info.size>2*1024*1024)throw new Error('PRESET_FILE_REJECTED');
   const data=await readFile(path,'utf8');if(Buffer.byteLength(data)>2*1024*1024)throw new Error('PRESET_FILE_REJECTED');
   return validatePreset(JSON.parse(data));
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new Error('PRESET_NOT_FOUND');throw new Error(e instanceof Error&&/^PRESET_/.test(e.message)?e.message:'PRESET_INVALID');}
 }
 async create(name:string,value:unknown):Promise<string> {
  name=presetFilename(name);const p=validatePreset(value),text=JSON.stringify(p,null,2)+'\n';
  if(Buffer.byteLength(text)>2*1024*1024)throw new Error('PRESET_TOO_LARGE');
  const existing=await this.list();
  if(existing.some(e=>e.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('PRESET_EXISTS');
  if(existing.length>=256)throw new Error('PRESET_LIMIT');
  if(this.directory){
   const root=await this.root(),temp=join(root,'.'+randomUUID()+'.tmp');
   try{await writeFile(temp,text,{flag:'wx',mode:0o600});await link(temp,join(root,name));}
   catch(e){throw new Error((e as NodeJS.ErrnoException).code==='EEXIST'?'PRESET_EXISTS':'PRESET_WRITE_FAILED');}
   finally{await unlink(temp).catch(()=>{});}
  }else this.memory.set(name,p);
  this.index.delete(name);return name;
 }
}
