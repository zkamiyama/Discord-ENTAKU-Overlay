import {readFile} from 'node:fs/promises';
import {dirname,resolve,relative} from 'node:path';
/** Build-time only includes. No runtime templates, new dependency or network IO. */
export async function webTemplate(path:string,root=dirname(resolve(path)),ancestors:readonly string[]=[]):Promise<string>{
 const absolute=resolve(path),rel=relative(root,absolute);
 if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||ancestors.includes(absolute))throw new Error('WEB_TEMPLATE_REJECTED');
 const source=await readFile(absolute,'utf8');
 const pattern=/<!--\s*@include\s+([\w./-]+)\s*-->|@import\s+"([\w./-]+)";/g;
 let output='',last=0;
 for(const match of source.matchAll(pattern)){
  output+=source.slice(last,match.index)+await webTemplate(resolve(dirname(absolute),match[1]??match[2]!),root,[...ancestors,absolute]);last=match.index!+match[0].length;
 }
 return output+source.slice(last);
}
