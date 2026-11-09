import {writeAtomicJson} from '../storage/atomic-json.ts';
import {mkdir,readdir,lstat,readFile,writeFile,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {presetFilename,validatePreset,type ParameterPreset} from './schema.ts';
export interface PresetEntry {name:string;valid:boolean;error?:string}
export class PresetStore {
 private memory=new Map<string,ParameterPreset>();
 private selection:ParameterPreset|null=null;
 constructor(private directory:string|null=null){}
 private async root():Promise<string>{const root=join(this.directory!,'presets');await mkdir(root,{recursive:true,mode:0o700});return root;}
 async list():Promise<PresetEntry[]> {
  const names=this.directory?(await readdir(await this.root())).filter(n=>/\.json$/i.test(n)):[...this.memory.keys()];
  if(names.length>256)throw new Error('PRESET_LIMIT');
  const entries:PresetEntry[]=[];
  for(const name of names.sort((a,b)=>a.localeCompare(b,'ja'))){try{await this.read(name);entries.push({name,valid:true});}catch(e){entries.push({name,valid:false,error:e instanceof Error?e.message:'PRESET_READ_FAILED'});}}
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
  return name;
 }
 /** Last applied preferences supply a template when no per-channel session exists. */
 async preferences(value?:ParameterPreset|null):Promise<ParameterPreset|null>{
  if(!this.directory){if(value!==undefined)this.selection=value===null?null:validatePreset(value);return structuredClone(this.selection);}
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const path=join(this.directory,'preset-state.json');
  if(value===null){await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});return null;}
  if(value){
   await writeAtomicJson(path,validatePreset(value),'PRESET_STATE_WRITE_FAILED');return value;
  }
  try{const info=await lstat(path);if(!info.isFile()||info.size>2*1024*1024)throw new Error();return validatePreset(JSON.parse(await readFile(path,'utf8')));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('PRESET_STATE_READ_FAILED');}
 }
}
