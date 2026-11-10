import type {StudioClient} from '../shared/client.ts';
import type {StoredGaussianAsset} from '../../assets/gaussian-store.ts';
import {validateGaussianManifest,validateGaussianProfile,type GaussianAvatarManifest,type GaussianAvatarProfile,type GaussianVec3} from '../../assets/gaussian-profile.ts';
import {GaussianPreview} from './gaussian-preview.ts';
import {installNumericControls,syncNumericControls} from './numeric-controls.ts';

const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>element<HTMLInputElement>('gaussian-'+id);
export const GAUSSIAN_ERROR_MESSAGES:Record<string,string>={
  GAUSSIAN_ASSET_NOT_FOUND:'素材を読み込めません。保存済みの素材を選ぶか、取り込み直してください。',
  GAUSSIAN_PLY_NOT_3DGS:'通常の点群PLYには対応していません。回転・縮尺・不透明度を持つ3DGS形式のPLYを選んでください。',
  GAUSSIAN_FILE_TOO_LARGE:'ファイルが大きすぎます。1ファイル128MiB以下にしてください。',
  GAUSSIAN_ARCHIVE_TOO_LARGE:'ZIPは192MiB以下、展開後の合計は256MiB以下にしてください。',
  GAUSSIAN_SPLAT_LIMIT:'1素材の上限は100万Splatです。元の素材を軽量化して取り込み直してください。',
  GAUSSIAN_ACTIVE_SPLAT_LIMIT:'割り当てる素材の合計が800万Splatを超えています。素材を軽量化してください。',
  GAUSSIAN_FILE_LIMIT:'ZIP内のファイル数は64個以下にしてください。',
  GAUSSIAN_STORE_FULL:'保存できる素材は128個、合計1GiBまでです。保存先を確認してください。',
  GAUSSIAN_ARCHIVE_INVALID:'ZIPが壊れているか、末尾が欠けています。キャラクターパッケージを書き出し直してください。',
  GAUSSIAN_MANIFEST_MISSING:'ZIPの直下にmanifest.jsonが必要です。単体のSPZまたは3DGS PLYも取り込めます。',
  GAUSSIAN_REFERENCE_MISSING:'manifest.jsonまたは代理メッシュが参照するファイルがありません。必要なファイルをZIPに含めてください。',
  GAUSSIAN_PATH_REJECTED:'パッケージ内のファイル名に使用できないパスがあります。相対パスで指定し、外部URLや「..」を除いてください。',
  GAUSSIAN_UNREFERENCED_FILE:'ZIPに未使用のファイルがあります。manifest.jsonと代理メッシュが参照する素材だけを含めてください。',
  GAUSSIAN_FORMAT_UNSUPPORTED:'対応形式はSPZまたは3DGS PLYです。',
  GAUSSIAN_SPZ_VERSION_UNSUPPORTED:'このSPZの版には対応していません。SPZ v1〜v4の標準形式で書き出してください。',
  GAUSSIAN_SPZ_EXTENSION_UNSUPPORTED:'このSPZの拡張形式には対応していません。標準形式のSPZまたは3DGS PLYで書き出してください。',
  GAUSSIAN_SPZ_INVALID:'SPZの内容または展開後のサイズが正しくありません。素材を書き出し直してください。',
  GAUSSIAN_PLY_DATA_INVALID:'PLYに欠損または使用できない数値があります。3DGS素材を書き出し直してください。',
  GAUSSIAN_PLY_FORMAT_UNSUPPORTED:'PLYはASCIIまたはbinary little-endian形式で書き出してください。',
  GAUSSIAN_NAME_INVALID:'キャラクター名を1〜80文字で入力してください。',
  GAUSSIAN_COORDINATES_INVALID:'上方向と正面方向には、異なる軸を指定してください。',
  GAUSSIAN_TRANSFORM_INVALID:'倍率、位置、回転には設定範囲内の数値を入力してください。',
  GAUSSIAN_BOUNDS_INVALID:'各範囲の最小値を最大値より小さくしてください。単位は正規化後のメートルです。',
  GAUSSIAN_FACE_OUTSIDE_BOUNDS:'顔の位置を顔の範囲内へ、顔の範囲を身体と撮影範囲の内側へ収めてください。',
  GAUSSIAN_BOUNDS_TOO_LARGE:'正規化後の身体は高さ4m、幅・奥行き2.8m以内にしてください。',
  GAUSSIAN_PROXY_INVALID:'代理メッシュを読み込めません。GLB形式と参照ファイルを確認してください。',
  GAUSSIAN_PREVIEW_INVALID:'パッケージのプレビュー画像には静止PNGを使用してください。',
  AVATAR_TOO_WIDE:'倍率・向き・横位置を含めた席の占有幅が2.8mを超えています。身体の範囲と配置を調整してください。',
  AVATAR_TOO_TALL:'身体の高さが4mまたは配置後の上端が3mを超えています。身体の範囲・倍率・縦位置を調整してください。',
  GAUSSIAN_MANIFEST_INVALID:'キャラクター設定が正しくありません。座標、倍率、顔を含む構図の範囲を確認してください。',
  INVALID_GAUSSIAN_MANIFEST:'キャラクター設定が正しくありません。座標、倍率、顔を含む構図の範囲を確認してください。',
  INVALID_GAUSSIAN_PROFILE:'倍率と位置を設定範囲内にしてください。',
};
function numeric(container:HTMLElement,key:string,label:string,min=-10,max=10,step=.01):void {
  const l=document.createElement('label');l.textContent=label;
  const field=document.createElement('input');field.type='number';field.id='gaussian-'+key;field.min=String(min);field.max=String(max);field.step=String(step);field.value='0';l.append(field);container.append(l);
}
function vector(container:HTMLElement,key:string,label:string):void {
  const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=label;group.append(legend);
  const row=document.createElement('div');row.className='avatar-fields';
  for(const axis of ['x','y','z'])numeric(row,key+'-'+axis,axis.toUpperCase()+'（m）');
  group.append(row);container.append(group);
}
function selection(container:HTMLElement,key:string,label:string,choices:readonly string[]):void {
  const l=document.createElement('label');l.textContent=label;const select=document.createElement('select');select.id='gaussian-'+key;
  for(const value of choices){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}l.append(select);container.append(l);
}

/** Holds unsaved character calibration; only the parent editor sends avatar-set. */
export class GaussianAvatarEditor {
  private asset:StoredGaussianAsset|null=null;
  private base:GaussianAvatarManifest|null=null;
  private preview:GaussianPreview|null=null;
  private userId='';
  private generation=0;
  private listGeneration=0;
  private active=false;
  private closed=false;
  private io=false;
  private previewPending=false;
  private previewFailed=false;
  private listeners=new AbortController();
  get pending():boolean{return this.io||this.previewPending;}
  get valid():boolean{try{this.draft();return !this.previewFailed;}catch{return false;}}
  constructor(private client:StudioClient,private changed:()=>void){
    const placement=element('gaussian-placement');placement.replaceChildren();
    numeric(placement,'scale','倍率',.25,3,.05);numeric(placement,'yaw','向き（度）',-180,180,1);
    numeric(placement,'offset-x','横位置（m）',-.5,.5);numeric(placement,'offset-y','縦位置（m）',-.5,.5);numeric(placement,'offset-z','前後位置（m）',-.5,.5);
    const geometry=element('gaussian-geometry-fields');geometry.replaceChildren();vector(geometry,'face-anchor','顔の位置');
    for(const [key,label] of [['face','顔の範囲'],['body','身体の範囲'],['framing','撮影範囲']]){
      vector(geometry,key+'-min',label+'・最小');vector(geometry,key+'-max',label+'・最大');
    }
    const normalization=element('gaussian-normalization-fields');normalization.replaceChildren();
    selection(normalization,'units','素材の単位',['m','cm','mm']);
    for(const [key,label] of [['up','素材の上方向'],['forward','素材の正面方向']] as const)selection(normalization,key,label,['+X','-X','+Y','-Y','+Z','-Z']);
    numeric(normalization,'normalization-scale','正規化の倍率',.000001,1000000,.01);
    vector(normalization,'translation','正規化の位置');
    const rotations=document.createElement('div');rotations.className='avatar-fields';
    for(const axis of ['x','y','z'])numeric(rotations,'rotation-'+axis,'回転'+axis.toUpperCase()+'（度）',-360,360,1);normalization.append(rotations);
    const options={signal:this.listeners.signal};
    element('gaussian-import').addEventListener('click',()=>void this.import(),options);
    element('gaussian-export').addEventListener('click',()=>void this.export(),options);
    element('gaussian-assets').addEventListener('change',()=>{const id=element<HTMLSelectElement>('gaussian-assets').value;if(id)void this.select(id);},options);
    for(const field of element('avatar-gaussian-fields').querySelectorAll('input[type=number],input[type=text],select:not(#gaussian-assets)'))field.addEventListener('input',()=>this.updatePreview(),options);
    installNumericControls();
  }
  async open(userId:string,profile?:GaussianAvatarProfile):Promise<void>{
    this.userId=userId;input('file').value='';input('proxy-file').value='';
    if(profile){this.base=structuredClone(profile.manifest);this.writeFields(profile);void this.select(profile.assetId,profile);}
    else{this.status('キャラクターを選ぶか、素材を取り込んでください。','empty');}
    await this.refreshList();
  }
  setActive(active:boolean):void {
    this.active=active;
    if(!active){this.preview?.dispose();this.preview=null;this.previewPending=false;return;}
    this.updatePreview();
  }
  private status(message:string,phase:string):void {
    if(this.closed)return;const target=element('gaussian-status');target.textContent=message;target.dataset.phase=phase;this.changed();
  }
  private report(error:unknown):void {
    const code=error instanceof Error?error.message:'取り込みに失敗しました。';
    this.status(GAUSSIAN_ERROR_MESSAGES[code]??`素材・設定を確認してください（${code}）。`,'error');
  }
  private value(id:string):number {const value=input(id).value;if(value==='')throw new Error('INVALID_GAUSSIAN_PROFILE');return Number(value);}
  private vec(id:string):GaussianVec3 {return ['x','y','z'].map(a=>this.value(id+'-'+a)) as unknown as GaussianVec3;}
  private writeVec(id:string,values:readonly number[]):void {['x','y','z'].forEach((a,i)=>{input(id+'-'+a).value=String(values[i]);});}
  private writeFields(profile:GaussianAvatarProfile):void {
    const m=profile.manifest;input('name').value=m.name;
    for(const [key,value] of Object.entries({scale:profile.scale,yaw:profile.yawRad*180/Math.PI,'offset-x':profile.offsetX,'offset-y':profile.offsetY,'offset-z':profile.offsetZ,'normalization-scale':m.normalization.scale}))input(key).value=String(value);
    this.writeVec('face-anchor',m.faceAnchor);this.writeVec('translation',m.normalization.translation);this.writeVec('rotation',m.normalization.rotation.map(v=>v*180/Math.PI));
    for(const [key,bounds] of [['face',m.faceBounds],['body',m.bodyBounds],['framing',m.framingBounds]] as const){this.writeVec(key+'-min',bounds.min);this.writeVec(key+'-max',bounds.max);}
    for(const key of ['units','up','forward'] as const)element<HTMLSelectElement>('gaussian-'+key).value=m.coordinates[key];
    syncNumericControls();
  }
  draft():GaussianAvatarProfile {
    if(!this.asset||!this.base)throw new Error('GAUSSIAN_ASSET_NOT_FOUND');
    const manifest=validateGaussianManifest({...this.base,name:input('name').value,
      coordinates:{units:element<HTMLSelectElement>('gaussian-units').value,up:element<HTMLSelectElement>('gaussian-up').value,forward:element<HTMLSelectElement>('gaussian-forward').value},
      normalization:{scale:this.value('normalization-scale'),rotation:this.vec('rotation').map(v=>v*Math.PI/180),translation:this.vec('translation')},
      faceAnchor:this.vec('face-anchor'),
      faceBounds:{min:this.vec('face-min'),max:this.vec('face-max')},bodyBounds:{min:this.vec('body-min'),max:this.vec('body-max')},framingBounds:{min:this.vec('framing-min'),max:this.vec('framing-max')},
    });
    return validateGaussianProfile({kind:'gaussian',userId:this.userId,assetId:this.asset.assetId,manifest,scale:this.value('scale'),yawRad:this.value('yaw')*Math.PI/180,offsetX:this.value('offset-x'),offsetY:this.value('offset-y'),offsetZ:this.value('offset-z')});
  }
  private updatePreview():void {
    if(!this.active||this.closed)return;
    element<HTMLButtonElement>('gaussian-export').disabled=!this.valid||this.io;
    let profile:GaussianAvatarProfile;
    try{profile=this.draft();}catch(error){if(this.asset)this.report(error);else this.changed();return;}
    this.previewFailed=false;
    try{
    if(!this.preview)this.preview=new GaussianPreview(element<HTMLCanvasElement>('gaussian-3d-preview'),status=>{
      if(this.closed||!this.active)return;
      this.previewPending=status.phase==='loading'||status.phase==='lod';this.previewFailed=status.phase==='error';
      const labels={loading:'素材を読み込んでいます。',lod:'表示の細かさを調整するデータを準備しています。',ready:'利用可能です。「適用」で本番の映像へ反映します。',error:'素材を表示できません。設定または素材を修正してください。'};
      this.status(labels[status.phase]+(status.message?`（${status.message}）`:''),status.phase);
    });
    this.preview.update(profile);
    }catch(error){this.preview?.dispose();this.preview=null;this.previewPending=false;this.previewFailed=true;this.report(error);}
    this.changed();
  }
  private async refreshList():Promise<void> {
    const generation=++this.listGeneration;
    try{const assets=await this.client.gaussianAssets();if(this.closed||generation!==this.listGeneration)return;const select=element<HTMLSelectElement>('gaussian-assets');select.replaceChildren(new Option('キャラクターを選択',''));for(const asset of assets)select.add(new Option(asset.manifest.name,asset.assetId));select.value=this.asset?.assetId??'';}catch(error){if(!this.asset&&!this.closed&&generation===this.listGeneration)this.report(error);}
  }
  private async select(assetId:string,profile?:GaussianAvatarProfile):Promise<void> {
    const generation=++this.generation;this.io=true;this.status('保存済みの素材を確認しています。','loading');
    try{const asset=await this.client.gaussianAsset(assetId);if(generation!==this.generation||this.closed)return;this.use(asset,profile);}
    catch(error){if(generation===this.generation&&!this.closed)this.report(error);}
    finally{if(generation===this.generation&&!this.closed){this.io=false;this.changed();}}
  }
  private use(asset:StoredGaussianAsset,profile?:GaussianAvatarProfile):void {
    if(this.previewFailed){this.preview?.dispose();this.preview=null;this.previewFailed=false;this.previewPending=false;}
    this.asset=asset;this.base=structuredClone(profile?.manifest??asset.manifest);
    const placement=asset.manifest.placement??{scale:1,offsetX:0,offsetY:0,offsetZ:0,yawRad:0};
    this.writeFields(profile??{kind:'gaussian',userId:this.userId,assetId:asset.assetId,manifest:this.base,...placement});
    element('gaussian-proxy-status').textContent=this.base.proxy?'代理メッシュあり：人物から机・床への影と、反射の形状に使います。':'代理メッシュなし：3DGSから影・反射用の深度と法線を描画します。薄い部分は画質設定の閾値で調整できます。';
    element<HTMLSelectElement>('gaussian-assets').value=asset.assetId;this.updatePreview();
  }
  private async import():Promise<void> {
    if(this.io||this.closed)return;const file=input('file').files?.[0];if(!file){this.status('取り込むファイルを選んでください。','empty');return;}
    const generation=++this.generation;this.io=true;this.status('素材を検証して取り込んでいます。','loading');element<HTMLButtonElement>('gaussian-import').disabled=true;
    try{const asset=await this.client.importGaussian(file,input('proxy-file').files?.[0]);if(generation!==this.generation||this.closed)return;this.use(asset);await this.refreshList();}
    catch(error){if(generation===this.generation&&!this.closed)this.report(error);}
    finally{if(generation===this.generation&&!this.closed){this.io=false;element<HTMLButtonElement>('gaussian-import').disabled=false;element<HTMLButtonElement>('gaussian-export').disabled=!this.valid;this.changed();}}
  }
  private async export():Promise<void> {
    if(this.io||this.closed)return;
    try{const profile=this.draft();this.io=true;this.changed();
      const {scale,offsetX,offsetY,offsetZ,yawRad}=profile;
      const blob=await this.client.exportGaussian(profile.assetId,{...profile.manifest,placement:{scale,offsetX,offsetY,offsetZ,yawRad}});
      if(this.closed)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=profile.manifest.name.replace(/[^\p{L}\p{N}_-]/gu,'_')+'.entaku.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      this.status('キャラクターのZIPを書き出しました。','ready');
    }catch(error){this.report(error);}finally{this.io=false;if(!this.closed)this.changed();}
  }
  dispose():void {if(this.closed)return;this.closed=true;this.generation++;this.listGeneration++;this.listeners.abort();this.preview?.dispose();this.preview=null;}
}
