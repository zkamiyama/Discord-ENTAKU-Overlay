import {ENVIRONMENT_LIMITS,type EnvironmentExportRequest,type EnvironmentImportRequest} from '../../environment/types.ts';
import {boundedText} from '../bounded-body.ts';
import {headers,json} from '../http.ts';
import {validOrigin} from '../security.ts';
import type {HttpRoute,RouteContext} from './context.ts';

const operations=new Set(['/api/environment/export','/api/environment/inspect','/api/environment/import']);
const multipartBytes=ENVIRONMENT_LIMITS.archiveBytes+1024*1024;
function version(value:FormDataEntryValue|null):number {
 if(typeof value!=='string'||!/^\d{1,16}$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('ENVIRONMENT_REQUEST_INVALID');
 return Number(value);
}
function failure(error:unknown):Response {
 const message=error instanceof Error?error.message:'';
 const code=/^(?:ENVIRONMENT|STUDIO|GAUSSIAN|SETTINGS|IMAGE|ASSET)_[A-Z0-9_]+$/.test(message)||message==='REVISION_CONFLICT'?message:'ENVIRONMENT_REQUEST_INVALID';
 const status=/TOO_LARGE|FILE_LIMIT/.test(code)?413:
  /CONFLICT|CONTEXT_CHANGED|PACKAGE_CHANGED|INSPECTION_REQUIRED/.test(code)?409:
  /WRITE_FAILED|STORAGE_UNAVAILABLE/.test(code)?500:code==='ENVIRONMENT_ICON_UNAVAILABLE'?502:422;
 return json({error:code},status);
}

/** One large archive at a time, including body parsing. Other settings writers
 * still share the normal serial queue, while provider events continue to flow. */
export function environmentRoutes(context:RouteContext):HttpRoute {
 const {environment,serial,settings,misskey,misskeyStream}=context;
 let busy=false;
 return async(request,url,port)=>{
  if(request.method==='GET'&&url.pathname==='/api/environment')return json(environment.status());
  if(request.method!=='POST'||!operations.has(url.pathname))return;
  if(!validOrigin(request,port))return json({error:'ORIGIN_REJECTED'},403);
  if(busy)return json({error:'ENVIRONMENT_BUSY'},503);
  const exporting=url.pathname.endsWith('/export'),type=request.headers.get('content-type')??'';
  if(exporting?!/^application\/json(?:;|$)/i.test(type):!/^multipart\/form-data(?:;|$)/i.test(type))return json({error:exporting?'JSON_REQUIRED':'MULTIPART_REQUIRED'},415);
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))return json({error:'ENVIRONMENT_REQUEST_INVALID'},422);
  if(Number(length)> (exporting?4096:multipartBytes))return json({error:'ENVIRONMENT_ARCHIVE_TOO_LARGE'},413);
  busy=true;
  try{
   if(exporting){
    const input:unknown=JSON.parse(await boundedText(request,4096));
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['theme','expectedRevision','expectedGeneration'].includes(key)))throw new Error('ENVIRONMENT_REQUEST_INVALID');
    return await serial(async()=>{
     try{
      const bytes=await environment.export(input as EnvironmentExportRequest);
      return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]),{headers:{...headers('application/zip'),'Content-Disposition':'attachment; filename="entaku-environment.entaku.zip"'}});
     }catch(error){return failure(error);}
    },request.signal);
   }
   const form=await request.formData(),importing=url.pathname.endsWith('/import');
   request.signal.throwIfAborted();
   const names=importing?['archive','sha256','expectedRevision','expectedGeneration']:['archive'];
   if([...form.keys()].some(key=>!names.includes(key))||names.some(key=>form.getAll(key).length!==1))throw new Error('ENVIRONMENT_REQUEST_INVALID');
   const archive=form.get('archive');
   if(!(archive instanceof File))throw new Error('ENVIRONMENT_REQUEST_INVALID');
   if(archive.size>ENVIRONMENT_LIMITS.archiveBytes)throw new Error('ENVIRONMENT_ARCHIVE_TOO_LARGE');
   const bytes=new Uint8Array(await archive.arrayBuffer());
   const input:EnvironmentImportRequest|undefined=importing?{
    expectedRevision:version(form.get('expectedRevision')),expectedGeneration:version(form.get('expectedGeneration')),
    sha256:typeof form.get('sha256')==='string'?form.get('sha256') as string:'',
   }:undefined;
   return await serial(async()=>{
    try{
     if(!input)return json(await environment.inspect(bytes));
     const result=await environment.import(bytes,input),current=settings.misskey().settings;
     // Live feeds are reconfigured only after assets, runtime and SQLite commit.
     misskey.configure(current);misskeyStream?.configure(current);
     context.options.onChange?.();context.broadcast();return json(result);
    }catch(error){return failure(error);}
   },request.signal);
  }catch(error){return failure(error);}finally{busy=false;}
 };
}
