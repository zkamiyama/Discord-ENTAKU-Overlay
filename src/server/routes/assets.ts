import {GAUSSIAN_LIMITS} from '../../assets/gaussian-profile.ts';
import {unpackStudioZip} from '../../studio/store.ts';
import {MAX_IMAGE_BYTES} from '../../assets/image.ts';
import {validOrigin} from '../security.ts';
import {json,headers,assetErrors} from '../http.ts';
import type {RouteContext,HttpRoute} from './context.ts';
export function assetRoutes(context:RouteContext):HttpRoute {
 const {studioStore,customAssets,avatars,serial,options:{engine}}=context;
 return async(request,url,port)=>{
      const gaussian=customAssets.gaussian;
      if(request.method==='GET'&&url.pathname==='/api/gaussian-assets'){
        try{return json(await gaussian.list());}catch{return json({error:'GAUSSIAN_INDEX_UNAVAILABLE'},500);}
      }
      const gsMatch=/^\/api\/gaussian-assets\/([a-f0-9]{64})(?:\/(file|export))?$/.exec(url.pathname);
      if(gsMatch&&(request.method==='GET'||(request.method==='POST'&&gsMatch[2]==='export'))){
        if(request.method==='POST'&&!validOrigin(request,port))return json({error:'ORIGIN_REJECTED'},403);
        try{
          if(gsMatch[2]==='file'){const file=await gaussian.file(gsMatch[1]!,url.searchParams.get('path')??'');return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]),{headers:headers(file.mime)});}
          if(gsMatch[2]==='export'){
            let manifest:unknown;if(request.method==='POST'){if(Number(request.headers.get('content-length')??0)>GAUSSIAN_LIMITS.manifestBytes)return json({error:'GAUSSIAN_FILE_TOO_LARGE'},413);const body=await request.text();if(body.length>GAUSSIAN_LIMITS.manifestBytes)return json({error:'GAUSSIAN_FILE_TOO_LARGE'},413);manifest=(JSON.parse(body) as {manifest?:unknown}).manifest;}
            const zip=await gaussian.exportZip(gsMatch[1]!,manifest);return new Response(new Blob([zip as Uint8Array<ArrayBuffer>]),{headers:{...headers('application/zip'),'Content-Disposition':'attachment; filename="entaku-avatar.zip"'}});
          }
          return json(await gaussian.asset(gsMatch[1]!));
        }catch(e){const code=e instanceof Error&&/^GAUSSIAN_[A-Z0-9_]+$/.test(e.message)?e.message:'GAUSSIAN_ASSET_NOT_FOUND';return json({error:code},request.method==='POST'?422:404);}
      }
      if(request.method==='POST'&&url.pathname==='/api/gaussian-assets/import'){
        if(!validOrigin(request,port))return json({error:'ORIGIN_REJECTED'},403);
        if(Number(request.headers.get('content-length')??0)>GAUSSIAN_LIMITS.archiveBytes+1024*1024)return json({error:'GAUSSIAN_ARCHIVE_TOO_LARGE'},413);
        return serial(async()=>{try{
          const form=await request.formData(),archive=form.get('archive');
          if(archive instanceof File){if(archive.size>GAUSSIAN_LIMITS.archiveBytes)throw new Error('GAUSSIAN_ARCHIVE_TOO_LARGE');return json(await gaussian.importZip(new Uint8Array(await archive.arrayBuffer())),201);}
          const splat=form.get('splat');if(!(splat instanceof File))throw new Error('GAUSSIAN_SOURCE_REQUIRED');
          if(splat.size>GAUSSIAN_LIMITS.fileBytes)throw new Error('GAUSSIAN_FILE_TOO_LARGE');
          const extras=[];for(const key of ['proxy','preview']){const file=form.get(key);if(file===null)continue;if(!(file instanceof File))throw new Error('GAUSSIAN_FILE_REJECTED');if(file.size>GAUSSIAN_LIMITS.fileBytes)throw new Error('GAUSSIAN_FILE_TOO_LARGE');extras.push({path:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}
          const text=form.get('manifest');if(text!==null&&(typeof text!=='string'||text.length>GAUSSIAN_LIMITS.manifestBytes))throw new Error('GAUSSIAN_MANIFEST_INVALID');
          let manifest:unknown;try{manifest=text===null?undefined:JSON.parse(text as string);}catch{throw new Error('GAUSSIAN_MANIFEST_INVALID');}
          return json(await gaussian.importRaw({path:splat.name,bytes:new Uint8Array(await splat.arrayBuffer())},extras,manifest),201);
        }catch(e){const code=e instanceof Error&&/^GAUSSIAN_[A-Z0-9_]+$/.test(e.message)?e.message:'GAUSSIAN_IMPORT_FAILED';return json({error:code},/TOO_LARGE|FILE_LIMIT/.test(code)?413:422);}});
      }
      if (request.method === 'GET' && url.pathname === '/api/studio/bundles') {
        try{return json(await studioStore.list());}catch{return json({error:'STUDIO_INDEX_UNAVAILABLE'},500);}
      }
      const bundleMatch=/^\/api\/studio\/bundles\/([a-f0-9]{64})(\/file)?$/.exec(url.pathname);
      if(request.method==='GET'&&bundleMatch){
        try{
          if(!bundleMatch[2])return json(await studioStore.bundle(bundleMatch[1]!));
          const file=await studioStore.file(bundleMatch[1]!,url.searchParams.get('path')??'');
          return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]),{headers:headers(file.mime)});
        }catch{return json({error:'STUDIO_FILE_NOT_FOUND'},404);}
      }
      if(request.method==='POST'&&url.pathname==='/api/studio/import'){
        if(!validOrigin(request,port))return json({error:'ORIGIN_REJECTED'},403);
        return serial(async()=>{
          try{
            const form=await request.formData(),entry=form.get('entry');
            if(entry!==null&&typeof entry!=='string')throw new Error('STUDIO_ENTRY_REQUIRED');
            const archive=form.get('archive');
            let files;
            if(archive instanceof File){files=unpackStudioZip(new Uint8Array(await archive.arrayBuffer()));}
            else{
              const inputs=[...form.entries()].filter(([name])=>name.startsWith('file:'));
              if(inputs.length>256)throw new Error('STUDIO_FILE_LIMIT');
              files=await Promise.all(inputs.map(async([name,value])=>{
                const file:unknown=value;
                if(!(file instanceof File))throw new Error('STUDIO_FILE_REJECTED');
                return {path:name.slice(5),bytes:new Uint8Array(await file.arrayBuffer())};
              }));
            }
            return json(await studioStore.importFiles(files,entry||undefined),201);
          }catch(e){const code=e instanceof Error&&/^STUDIO_[A-Z_]+$/.test(e.message)?e.message:'STUDIO_IMPORT_FAILED';return json({error:code},422);}
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/assets') {
        if (!validOrigin(request,port)) return json({error:'ORIGIN_REJECTED'},403);
        if (!['image/png','image/webp'].includes(request.headers.get('content-type')??'')) return json({error:'IMAGE_FORMAT_REJECTED'},415);
        if(Number(request.headers.get('content-length')??0)>MAX_IMAGE_BYTES)return json({error:'IMAGE_TOO_LARGE'},413);
        return serial(async()=>{
          try { const data=new Uint8Array(await request.arrayBuffer());return json(await customAssets.importImage(data),201); }
          catch(e){const code=e instanceof Error&&assetErrors.has(e.message)?e.message:'ASSET_IMPORT_FAILED';return json({error:code},code==='IMAGE_TOO_LARGE'?413:422);}
        });
      }
      const customMatch=/^\/api\/assets\/([a-f0-9]{64})$/.exec(url.pathname);
      if(request.method==='GET'&&customMatch){
        try{const {info,bytes}=await customAssets.get(customMatch[1]!);return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]),{headers:headers(info.mime)});}
        catch{return json({error:'ASSET_NOT_FOUND'},404);}
      }
      const avatarMatch = /^\/api\/avatars\/(\d{1,20})$/.exec(url.pathname);
      if (request.method === 'GET' && avatarMatch) {
        const person = engine.snapshot().participants.find(p => p.userId === avatarMatch[1]);
        if (!person?.avatarUrl) return json({ error: 'AVATAR_NOT_FOUND' }, 404);
        try { const data = await avatars.get(person.avatarUrl); return new Response(new Blob([data as Uint8Array<ArrayBuffer>]), { headers: headers('image/png') }); }
        catch { return json({ error: 'AVATAR_UNAVAILABLE' }, 502); }
      }
 };
}
