import type {AppEngine} from '../domain/engine.ts';
import type {AvatarStore} from '../assets/store.ts';
import type {AvatarProfile} from '../assets/avatar-profile.ts';
import type {StudioStore} from '../studio/store.ts';
import type {PresetStore} from '../presets/store.ts';
import {capturePreset,validatePreset} from '../presets/schema.ts';
import type {SettingsData,SettingsStore} from '../storage/settings-store.ts';
import {presetPreferences} from '../storage/settings-schema.ts';
import {validateMisskeySettings} from '../misskey/settings.ts';
import type {MisskeySettings} from '../contracts/misskey.ts';
import type {NoteIntroductionSettings} from '../contracts/note-introduction.ts';
import {validateNoteIntroductionSettings} from '../note-introduction/settings.ts';

/** Await asset validation, then plan and durably commit in one synchronous
 * domain transaction. Failed writes never require compensating filesystem I/O. */
export class SettingsService {
  constructor(
    private engine:AppEngine,
    private settings:SettingsStore,
    private studios:StudioStore,
    private avatars:AvatarStore,
    private presets:PresetStore,
    private now:()=>number,
  ){}
  private guard(revision:number,preset=false):()=>void{
    const context=this.engine.settingsContextVersion;
    const check=()=>{
      if(this.engine.settingsContextVersion!==context)throw new Error(preset?'PRESET_CONTEXT_CHANGED':'SETTINGS_CONTEXT_CHANGED');
      if(this.engine.currentRevision!==revision)throw new Error('REVISION_CONFLICT');
    };
    check();return check;
  }
  private commit(settings:SettingsData):void{
    const state=this.engine.snapshot(),source=this.engine.source;
    this.settings.commit(settings,state.channel&&source!=='replay'?{source,session:state.session}:undefined);
  }
  misskey():{generation:number;settings:MisskeySettings}{
    const current=this.settings.snapshot();return {generation:current.generation,settings:current.misskey};
  }
  setMisskey(input:unknown,generation:number):{generation:number;settings:MisskeySettings}{
    const clean=validateMisskeySettings(input),before=this.settings.snapshot();
    if(generation!==before.generation)throw new Error('SETTINGS_CONFLICT');
    this.settings.commit({...before,misskey:clean});
    return this.misskey();
  }
  noteIntroduction():{generation:number;settings:NoteIntroductionSettings}{
    const current=this.settings.snapshot();return {generation:current.generation,settings:current.noteIntroduction};
  }
  setNoteIntroduction(input:unknown,generation:number):{generation:number;settings:NoteIntroductionSettings}{
    const clean=validateNoteIntroductionSettings(input),before=this.settings.snapshot();
    if(generation!==before.generation)throw new Error('SETTINGS_CONFLICT');
    this.settings.commit({...before,noteIntroduction:clean});
    return this.noteIntroduction();
  }
  async scene(input:unknown,revision:number):Promise<void>{
    const check=this.guard(revision),clean=await this.studios.validateDraft(input);
    check();
    const before=this.settings.snapshot();clean.revision=before.studio.revision+1;
    this.engine.setStudioScene(clean,revision,this.now(),()=>this.commit({...before,studio:clean}));
  }
  async avatar(input:unknown,revision:number):Promise<void>{
    const check=this.guard(revision),profile=await this.avatars.validateDraft(input);
    await this.profiles([...this.engine.avatarProfiles().filter(p=>p.userId!==profile.userId),profile],revision,check);
  }
  async resetAvatar(userId:string,revision:number):Promise<void>{
    await this.profiles(this.engine.avatarProfiles().filter(p=>p.userId!==userId),revision,this.guard(revision));
  }
  private async profiles(profiles:AvatarProfile[],revision:number,check:()=>void):Promise<void>{
    const clean=await this.avatars.validateProfiles(profiles);check();
    const before=this.settings.snapshot();
    this.engine.setAvatarProfiles(clean,revision,this.now(),()=>this.commit({...before,avatarProfiles:clean}));
  }
  async preset(name:string,revision:number):Promise<Record<string,unknown>>{
    const check=this.guard(revision,true),p=await this.presets.read(name);
    const scene=await this.studios.validateDraft(p.studio);
    for(const item of scene.objects)if(item.kind==='model'){
      for(const file of (await this.studios.bundle(item.bundleId)).files)await this.studios.file(item.bundleId,file.path);
    }
    const profiles=await this.avatars.validateProfiles(await Promise.all(p.avatarProfiles.map(a=>this.avatars.validateDraft(a))));
    const clean=validatePreset({...p,studio:scene,avatarProfiles:profiles});check();
    clean.studio.revision=this.settings.snapshot().studio.revision+1;
    let signature='';
    this.engine.applyPreset(clean,revision,this.now(),()=>{
      signature=JSON.stringify(capturePreset(this.engine.snapshot(),p.theme));
      this.commit({...this.settings.snapshot(),studio:clean.studio,avatarProfiles:clean.avatarProfiles,preferences:presetPreferences(clean)});
    });
    return {presetName:name,theme:p.theme,presetSignature:signature};
  }
}
