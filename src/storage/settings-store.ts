import {Database} from 'bun:sqlite';
import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,link,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {SeatSession} from '../contracts/domain.ts';
import {validateSession} from '../domain/seat-allocator.ts';
import {readLegacySettings} from './legacy-settings.ts';
import {readLegacySessions} from './legacy-sessions.ts';
import {defaultSettings,validateSettings,type SettingsData,type SettingsSnapshot} from './settings-schema.ts';
export type {SettingsData,SettingsSnapshot} from './settings-schema.ts';
export type SessionSource='demo'|'ipc';

const APPLICATION_ID=0x454e544b,SCHEMA_VERSION=1,MAX_SETTINGS_BYTES=4*1024*1024,MAX_SESSION_BYTES=1024*1024;
const specialError=(error:unknown,code:string):Error=>error instanceof Error&&/^SETTINGS_(CONFLICT|SCHEMA_UNSUPPORTED|NOT_INITIALIZED|PUBLISH_FAILED)$/.test(error.message)?error:new Error(code,{cause:error});
const sourceKey=(source:SessionSource):SessionSource=>{if(source!=='demo'&&source!=='ipc')throw new Error('SESSION_SOURCE_INVALID');return source;};
const sessionKey=(source:SessionSource,channel:string)=>`${source}:${channel}`;
function encode(value:unknown,limit:number,code:string):string{
  const text=JSON.stringify(value);if(Buffer.byteLength(text)>limit)throw new Error(code);return text;
}
interface RestoredSettings {settings:SettingsSnapshot;versions:Map<string,number>}

/** One durable transaction owns settings and any session changed by a preset.
 * Connections never survive a method call; reads used by the live app stay in
 * memory. SQLite owns crash recovery, file locking and the rollback journal. */
export class SettingsStore {
  private current:SettingsSnapshot;
  private initialized:boolean;
  private versions=new Map<string,number>();
  private memorySessions=new Map<SessionSource,Map<string,SeatSession>>();
  constructor(private readonly directory:string|null=null,initial:SettingsData=defaultSettings()){
    this.current=validateSettings({...initial,schemaVersion:1,generation:0});this.initialized=directory===null;
  }
  private ready():void{if(!this.initialized)throw new Error('SETTINGS_NOT_INITIALIZED');}
  get generation():number{this.ready();return this.current.generation;}
  snapshot():SettingsSnapshot{this.ready();return structuredClone(this.current);}

  private database<T>(work:(db:Database)=>T,path=join(this.directory!,'settings.sqlite')):T{
    const db=new Database(path,{create:false,strict:true});
    try{
      // No busy wait on the realtime application's event loop. Another writer
      // yields an explicit failure; commands with effects are never retried.
      db.run('PRAGMA busy_timeout=0; PRAGMA synchronous=EXTRA; PRAGMA trusted_schema=OFF;');
      const mode=db.query<{journal_mode:string},[]>('PRAGMA journal_mode=DELETE').get();
      if(mode?.journal_mode!=='delete')throw new Error('SETTINGS_WRITE_FAILED');
      return work(db);
    }finally{
      // Bun 1.4.4 owns both query and transaction-controller statements. This
      // finalizes them immediately without turning COMMIT into a close error.
      db.close(false);
    }
  }
  private checkSchema(db:Database):void{
    const app=db.query<{application_id:number},[]>('PRAGMA application_id').get()!.application_id;
    const version=db.query<{user_version:number},[]>('PRAGMA user_version').get()!.user_version;
    if(app!==APPLICATION_ID||version!==SCHEMA_VERSION)throw new Error('SETTINGS_SCHEMA_UNSUPPORTED');
  }
  private read(db:Database):SettingsSnapshot{
    this.checkSchema(db);
    const row=db.query<{generation:number;document:string},[]>('SELECT generation,document FROM settings WHERE id=1 AND length(CAST(document AS BLOB))<=4194304').get();
    if(!row)throw new Error('SETTINGS_READ_FAILED');
    const result=validateSettings(JSON.parse(row.document));
    if(result.generation!==row.generation)throw new Error('SETTINGS_READ_FAILED');
    return result;
  }
  private readVersions(db:Database):Map<string,number>{
    const rows=db.query<{source:SessionSource;channel_id:string;version:number},[]>('SELECT source,channel_id,version FROM sessions LIMIT 2049').all();
    const versions=new Map<string,number>(),counts={demo:0,ipc:0};
    for(const row of rows){
      sourceKey(row.source);
      if(++counts[row.source]>1024||!/^\d{1,20}$/.test(row.channel_id)||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('SESSION_READ_FAILED');
      versions.set(sessionKey(row.source,row.channel_id),row.version);
    }
    return versions;
  }
  private restore():RestoredSettings{
    return this.database(db=>db.transaction(()=>({settings:this.read(db),versions:this.readVersions(db)}))());
  }
  async initialize():Promise<SettingsSnapshot>{
    if(this.initialized)return this.snapshot();
    await mkdir(this.directory!,{recursive:true,mode:0o700});
    try{
      const file=join(this.directory!,'settings.sqlite');
      const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(info&&!info.isFile())throw new Error('SETTINGS_READ_FAILED');
      if(!info){
        const [settings,sessions]=await Promise.all([readLegacySettings(this.directory!),readLegacySessions(this.directory!)]);
        const initial=validateSettings({...settings,schemaVersion:1,generation:0});
        const text=encode(initial,MAX_SETTINGS_BYTES,'SETTINGS_TOO_LARGE');
        const temporary=join(this.directory!,`.settings-${randomUUID()}.sqlite`);
        let complete=false,published=false;
        try{
          const handle=await open(temporary,'wx',0o600);await handle.close();
          this.database(db=>db.transaction(()=>{
            db.run(`CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL,document TEXT NOT NULL) STRICT;
              CREATE TABLE sessions(source TEXT NOT NULL CHECK(source IN ('demo','ipc')),channel_id TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(source,channel_id)) STRICT;
              PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};`);
            db.query('INSERT INTO settings(id,generation,document) VALUES(1,0,?)').run(text);
            for(const {source,session} of sessions)this.writeSession(db,source,session,0);
          }).immediate(),temporary);
          complete=true;
          // Publish only a complete, closed database. A pre-existing canonical
          // database, including a truncated one, is never treated as an import.
          try{await link(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw new Error('SETTINGS_PUBLISH_FAILED',{cause:error});}
          published=true;
        }finally{
          // Preserve a complete candidate if the filesystem cannot publish it.
          // Cleanup after publication cannot turn success into an unsaved edit.
          if(published||!complete)await rm(temporary,{force:true}).catch(()=>{});
        }
      }
      const restored=this.restore();
      this.current=restored.settings;this.versions=restored.versions;this.initialized=true;
      return this.snapshot();
    }catch(error){
      if(error instanceof Error&&/^(STUDIO_SETTINGS_READ_FAILED|AVATAR_SETTINGS_READ_FAILED|PRESET_STATE_READ_FAILED|SESSION_READ_FAILED|TOO_MANY_SESSIONS)$/.test(error.message))throw error;
      throw specialError(error,'SETTINGS_READ_FAILED');
    }
  }
  private checkGeneration(db:Database):void{
    this.checkSchema(db);
    const row=db.query<{generation:number},[]>('SELECT generation FROM settings WHERE id=1').get();
    if(row?.generation!==this.current.generation)throw new Error('SETTINGS_CONFLICT');
  }
  private writeSession(db:Database,source:SessionSource,session:SeatSession,expectedVersion:number):void{
    sourceKey(source);
    const row=db.query<{version:number},[string,string]>('SELECT version FROM sessions WHERE source=? AND channel_id=?').get(source,session.channelId);
    if((row?.version??0)!==expectedVersion)throw new Error('SETTINGS_CONFLICT');
    if(!row&&db.query<{count:number},[string]>('SELECT count(*) AS count FROM sessions WHERE source=?').get(source)!.count>=1024)throw new Error('TOO_MANY_SESSIONS');
    db.query('INSERT INTO sessions(source,channel_id,version,document) VALUES(?,?,?,?) ON CONFLICT(source,channel_id) DO UPDATE SET version=excluded.version,document=excluded.document')
      .run(source,session.channelId,expectedVersion+1,encode(session,MAX_SESSION_BYTES,'SESSION_TOO_LARGE'));
  }
  private nextVersions(source:SessionSource,session:SeatSession):Map<string,number>{
    const key=sessionKey(source,session.channelId),version=(this.versions.get(key)??0)+1;
    if(!Number.isSafeInteger(version))throw new Error('SESSION_WRITE_FAILED');
    const next=new Map(this.versions);next.set(key,version);return next;
  }
  commit(value:SettingsData,active?:{source:SessionSource;session:SeatSession}):void{
    this.ready();
    const next=validateSettings({...value,schemaVersion:1,generation:this.current.generation+1});
    const text=encode(next,MAX_SETTINGS_BYTES,'SETTINGS_TOO_LARGE');
    const session=active?validateSession(active.session):undefined;
    if(active)sourceKey(active.source);
    const versions=active&&session?this.nextVersions(active.source,session):this.versions;
    try{
      if(this.directory)this.database(db=>db.transaction(()=>{
        this.checkGeneration(db);
        db.query('UPDATE settings SET generation=?,document=? WHERE id=1').run(next.generation,text);
        if(active&&session)this.writeSession(db,active.source,session,this.versions.get(sessionKey(active.source,session.channelId))??0);
      }).immediate());
      else if(active&&session)this.setMemorySession(active.source,session);
    }catch(error){throw specialError(error,'SETTINGS_WRITE_FAILED');}
    // No callbacks, asynchronous work or fallible validation after COMMIT.
    this.current=next;this.versions=versions;
  }
  loadSessions(source:SessionSource):SeatSession[]{
    this.ready();sourceKey(source);
    if(!this.directory)return structuredClone([...(this.memorySessions.get(source)?.values()??[])]);
    try{
      const restored=this.database(db=>db.transaction(()=>{
        this.checkGeneration(db);
        const rows=db.query<{channel_id:string;version:number;document:string;bytes:number},[string]>('SELECT channel_id,version,CASE WHEN length(CAST(document AS BLOB))<=1048576 THEN document END AS document,length(CAST(document AS BLOB)) AS bytes FROM sessions WHERE source=? LIMIT 1025').all(source);
        if(rows.length>1024)throw new Error('TOO_MANY_SESSIONS');
        const sessions=rows.map(row=>{
          if(row.bytes>MAX_SESSION_BYTES||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('SESSION_READ_FAILED');
          const session=validateSession(JSON.parse(row.document));
          if(session.channelId!==row.channel_id)throw new Error('SESSION_READ_FAILED');
          return session;
        });
        const versions=new Map(this.versions);
        for(const key of versions.keys())if(key.startsWith(`${source}:`))versions.delete(key);
        for(const row of rows)versions.set(sessionKey(source,row.channel_id),row.version);
        return {sessions,versions};
      })());
      this.versions=restored.versions;return restored.sessions;
    }catch(error){throw specialError(error,'SESSION_READ_FAILED');}
  }
  private setMemorySession(source:SessionSource,session:SeatSession):void{
    let sessions=this.memorySessions.get(source);
    if(!sessions){sessions=new Map();this.memorySessions.set(source,sessions);}
    if(!sessions.has(session.channelId)&&sessions.size>=1024)throw new Error('TOO_MANY_SESSIONS');
    sessions.set(session.channelId,session);
  }
  saveSession(source:SessionSource,input:SeatSession,expectedGeneration:number):boolean{
    this.ready();sourceKey(source);
    if(Number.isSafeInteger(expectedGeneration)&&expectedGeneration<this.current.generation)return false;
    if(expectedGeneration!==this.current.generation)throw new Error('SETTINGS_CONFLICT');
    const session=validateSession(input),versions=this.nextVersions(source,session);
    try{
      if(this.directory)this.database(db=>db.transaction(()=>{
        this.checkGeneration(db);this.writeSession(db,source,session,this.versions.get(sessionKey(source,session.channelId))??0);
      }).immediate());
      else this.setMemorySession(source,session);
    }catch(error){throw specialError(error,'SESSION_WRITE_FAILED');}
    this.versions=versions;return true;
  }
}
