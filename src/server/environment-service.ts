import {createHash} from 'node:crypto';
import type {AppSnapshot} from '../contracts/domain.ts';
import type {AppEngine} from '../domain/engine.ts';
import type {AvatarStore} from '../assets/store.ts';
import type {StudioStore} from '../studio/store.ts';
import {capturePreset,validatePreset} from '../presets/schema.ts';
import {presetPreferences,type SettingsSnapshot} from '../storage/settings-schema.ts';
import type {SettingsStore} from '../storage/settings-store.ts';
import {createEnvironmentPreview} from '../environment/preview.ts';
import {environmentHash} from '../environment/archive.ts';
import {collectEnvironmentPackage,inspectEnvironmentPackage,publishEnvironmentPackage,exportEnvironmentPackage} from '../environment/package.ts';
import {ENVIRONMENT_LIMITS,validateEnvironmentPeople,type EnvironmentExportRequest,type EnvironmentImportRequest,
  type EnvironmentImportResult,type EnvironmentInspection,type EnvironmentPerson,type EnvironmentStatus,type EnvironmentVersion} from '../environment/types.ts';
import {VERSION} from '../version.ts';
import type {AvatarCache} from './avatar-cache.ts';

interface InspectionContext {revision:number;generation:number;context:number}

/** Assets are immutable and published before the synchronous domain/SQLite
 * commit. No rollback ever restores live membership across an await. */
export class EnvironmentService {
  private cachedSettings:SettingsSnapshot|null=null;
  private icons=new Map<string,string>();
  private preview:AppEngine|null=null;
  private previewGeneration=-1;
  private inspected=new Map<string,InspectionContext>();
  constructor(
    private engine:AppEngine,
    private settings:SettingsStore,
    private studios:StudioStore,
    private avatars:AvatarStore,
    private avatarCache:AvatarCache,
    private now:()=>number,
  ){}
  private saved():SettingsSnapshot {
    if(this.cachedSettings?.generation!==this.settings.generation){
      this.cachedSettings=this.settings.snapshot();
      this.icons=new Map(this.cachedSettings.environment?.identities.filter(person=>person.iconAssetId).map(person=>[person.userId,person.iconAssetId!]));
    }
    return this.cachedSettings;
  }
  private guard(version:EnvironmentVersion):()=>void {
    if(!version||typeof version!=='object'||!Number.isSafeInteger(version.expectedRevision)||version.expectedRevision<0||
      !Number.isSafeInteger(version.expectedGeneration)||version.expectedGeneration<0)throw new Error('ENVIRONMENT_REQUEST_INVALID');
    const context=this.engine.settingsContextVersion;
    const check=()=>{
      if(this.engine.settingsContextVersion!==context)throw new Error('ENVIRONMENT_CONTEXT_CHANGED');
      if(this.engine.currentRevision!==version.expectedRevision)throw new Error('REVISION_CONFLICT');
      if(this.settings.generation!==version.expectedGeneration)throw new Error('SETTINGS_CONFLICT');
    };
    check();return check;
  }
  status():EnvironmentStatus {
    const settings=this.saved();
    return {generation:settings.generation,previewAvailable:settings.environment!==null,limits:ENVIRONMENT_LIMITS};
  }
  /** Saved Discord portraits belong to reproduction previews. A live Discord
   * participant always uses the current provider's avatarUrl, including removal. */
  decorate(snapshot:AppSnapshot):AppSnapshot {
    if(snapshot.source!=='demo'||!snapshot.serverEpoch.startsWith('environment-'))return snapshot;
    this.saved();
    if(!this.icons.size)return snapshot;
    return {...snapshot,participants:snapshot.participants.map(person=>{
      const iconAssetId=this.icons.get(person.userId);
      return iconAssetId?{...person,iconAssetId}:person;
    })};
  }
  previewEngine(now=this.now()):AppEngine|null {
    const settings=this.saved();
    if(this.previewGeneration!==settings.generation){
      this.preview=createEnvironmentPreview(settings,now);this.previewGeneration=settings.generation;
    }
    return this.preview;
  }
  previewSnapshot(now=this.now()):AppSnapshot|null {
    const engine=this.previewEngine(now);
    if(!engine)return null;
    engine.tick(now);return this.decorate(engine.snapshot(now));
  }
  async export(request:EnvironmentExportRequest):Promise<Uint8Array> {
    const check=this.guard(request);
    if(!['system','light','dark'].includes(request.theme))throw new Error('ENVIRONMENT_REQUEST_INVALID');
    const snapshot=this.engine.snapshot(),settings=this.saved(),preset=capturePreset(snapshot,request.theme);
    // Before the first voice snapshot, AppEngine still owns its unbound default
    // allocator. Keep the saved seating when re-exporting an offline restart.
    if(snapshot.channel===null&&snapshot.session.channelId==='0'&&settings.preferences)preset.seating=structuredClone(settings.preferences.seating);
    const previous=new Map(settings.environment?.identities.map(person=>[person.userId,person]));
    const current=new Map(snapshot.participants.map(person=>[person.userId,person]));
    const referenced=new Set([...preset.seating.assignments.map(a=>a.userId),...preset.avatarProfiles.map(a=>a.userId),...current.keys()]);
    for(const object of preset.studio.objects)if(object.kind==='model'&&object.speakerUserId)referenced.add(object.speakerUserId);
    const identities:EnvironmentPerson[]=[];
    const urls=new Map<string,string>();
    for(const userId of referenced){
      const person=current.get(userId),saved=previous.get(userId),identity=person??saved;
      if(!identity)continue;
      // A participant without an avatarUrl now has a default Discord portrait.
      // Do not resurrect an older saved icon after an avatar was deleted.
      const live=person&&snapshot.channel!==null;
      identities.push({userId,username:identity.username,displayName:identity.displayName,
        ...(!live&&saved?.iconAssetId?{iconAssetId:saved.iconAssetId}:{})});
      if(live&&person.avatarUrl)urls.set(userId,person.avatarUrl);
    }
    identities.sort((a,b)=>a.userId.localeCompare(b.userId));
    const known=new Set(identities.map(person=>person.userId));
    const present=snapshot.channel===null?new Set(settings.environment?.presentUserIds??[]):
      new Set(snapshot.participants.filter(person=>person.presence!=='absent').map(person=>person.userId));
    const people=validateEnvironmentPeople({identities,presentUserIds:preset.seating.assignments.map(a=>a.userId).filter(id=>known.has(id)&&present.has(id))});
    const extraImages=new Map<string,Uint8Array>();
    let next=0,stopped=false;
    const fetched=await Promise.allSettled(Array.from({length:Math.min(8,people.identities.length)},async()=>{
      try{
        while(!stopped){
          const person=people.identities[next++];if(!person)return;
          const url=urls.get(person.userId);if(!url)continue;
          const bytes=await this.avatarCache.get(url).catch(error=>{throw new Error('ENVIRONMENT_ICON_UNAVAILABLE',{cause:error});});
          check();
          const assetId=createHash('sha256').update(bytes).digest('hex');
          extraImages.set(assetId,bytes);person.iconAssetId=assetId;
        }
      }catch(error){stopped=true;throw error;}
    }));
    for(const result of fetched)if(result.status==='rejected')throw result.reason;
    check();
    const content=await collectEnvironmentPackage({appVersion:VERSION,createdAt:new Date().toISOString(),preset,misskey:settings.misskey,noteIntroduction:settings.noteIntroduction,people},
      {studios:this.studios,avatars:this.avatars},extraImages);
    check();
    const bytes=await exportEnvironmentPackage(content);check();return bytes;
  }
  async inspect(bytes:Uint8Array):Promise<EnvironmentInspection> {
    const {summary}=await inspectEnvironmentPackage(bytes);
    const record={revision:this.engine.currentRevision,generation:this.settings.generation,context:this.engine.settingsContextVersion};
    this.inspected.delete(summary.sha256);
    if(this.inspected.size>=8)this.inspected.delete(this.inspected.keys().next().value!);
    this.inspected.set(summary.sha256,record);
    return {summary,revision:record.revision,generation:record.generation};
  }
  async import(bytes:Uint8Array,request:EnvironmentImportRequest):Promise<EnvironmentImportResult> {
    const check=this.guard(request);
    if(typeof request.sha256!=='string'||!/^[a-f0-9]{64}$/.test(request.sha256))throw new Error('ENVIRONMENT_REQUEST_INVALID');
    if(await environmentHash(bytes)!==request.sha256)throw new Error('ENVIRONMENT_PACKAGE_CHANGED');
    check();
    const inspection=this.inspected.get(request.sha256);
    if(!inspection)throw new Error('ENVIRONMENT_INSPECTION_REQUIRED');
    if(inspection.context!==this.engine.settingsContextVersion)throw new Error('ENVIRONMENT_CONTEXT_CHANGED');
    if(inspection.revision!==request.expectedRevision)throw new Error('REVISION_CONFLICT');
    if(inspection.generation!==request.expectedGeneration)throw new Error('SETTINGS_CONFLICT');
    const {content,summary}=await inspectEnvironmentPackage(bytes);
    if(summary.sha256!==request.sha256)throw new Error('ENVIRONMENT_PACKAGE_CHANGED');
    check();
    await publishEnvironmentPackage(content,{studios:this.studios,avatars:this.avatars});
    check();
    const before=this.saved(),preset=validatePreset(content.manifest.preset);
    preset.studio.revision=before.studio.revision+1;
    this.engine.applyPreset(preset,request.expectedRevision,this.now(),()=>{
      const state=this.engine.snapshot(),source=this.engine.source;
      this.settings.commit({...before,studio:preset.studio,avatarProfiles:preset.avatarProfiles,preferences:presetPreferences(preset),
        misskey:content.manifest.misskey,environment:content.manifest.people,noteIntroduction:content.manifest.noteIntroduction??before.noteIntroduction},
      state.channel&&source!=='replay'?{source,session:state.session}:undefined);
    });
    this.inspected.delete(request.sha256);
    return {summary,theme:preset.theme,generation:this.settings.generation,previewAvailable:true};
  }
}
