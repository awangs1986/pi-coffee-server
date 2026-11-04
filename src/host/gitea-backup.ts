import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,cp,lstat,readFile,realpath,readdir,rm} from 'node:fs/promises';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {BackupError} from './backup.js';
import type {BackupRepository} from './backup-repository.js';
import {createStateArchive,verifyStateArchive} from './state-archive.js';
import {durableJson,readJson,restoreFail,restoreLock,sha,treeDigest,exists,syncDir} from './restore-files.js';
const execute=promisify(execFile);
export interface GiteaBackupProfile {
 coffee:{configurationFiles:string[];bindings:{accountId:string;scope:string;projects:string}[]};
 schema:1;binary:string;version:string;appIni:string;workPath:string;roots:Record<string,string>;
 checkStopped:string[];stop?:string[];start:string[];allowServicePause?:boolean;url?:string;
}
interface RootAction {source:string;target:string;dev:number;ino:number;digest:string;parent:{dev:number;ino:number};before?:{dev:number;ino:number;digest:string};}
interface GiteaRestorePlan {pinId?:string;publicationComplete?:boolean;schema:1;id:string;jobId:string;state:'staged'|'publishing'|'completed'|'failed';digest:string;profile:GiteaBackupProfile;actions:RootAction[];done:string[];errorCode?:string;serviceState?:'start-requested'|'healthy';}
const inside=(parent:string,path:string)=>{const rel=relative(resolve(parent),resolve(path));return !rel||!rel.startsWith('..')&&!isAbsolute(rel);};
async function run(command:string[]){if(!Array.isArray(command)||!command.length||command.some(arg=>typeof arg!=='string'||!arg)||!isAbsolute(command[0]))throw restoreFail('invalid_service_command');try{await execute(command[0],command.slice(1),{timeout:60000,maxBuffer:8192});}catch{throw restoreFail('service_command_failed');}}
async function parentIdentity(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||await realpath(path)!==resolve(path))throw restoreFail('service_target_parent_changed');return {dev:info.dev,ino:info.ino};}
async function syncTree(path:string):Promise<void>{const info=await lstat(path);if(info.isSymbolicLink())return;if(info.isDirectory()){for(const name of await (await import('node:fs/promises')).readdir(path))await syncTree(join(path,name));await syncDir(path);}else{const file=await (await import('node:fs/promises')).open(path,'r');try{await file.sync();}finally{await file.close();}}}

/** A small owner-operated local Gitea job. Only explicitly configured maintenance
 * commands may pause Gitea; Host/model processes are never controlled here. */
export class GiteaBackupJob {
 readonly root:string;
 constructor(private options:{root:string;repository:BackupRepository;profile:string}){this.root=resolve(options.root);}
 private async profile():Promise<GiteaBackupProfile>{
  const info=await lstat(this.options.profile);if((info.mode&0o077)!==0)throw restoreFail('gitea_profile_not_private');
  const p:GiteaBackupProfile=await readJson(this.options.profile);
  if(p.schema!==1||!isAbsolute(p.binary)||!/^\d+\.\d+\.\d+$/.test(p.version)||!isAbsolute(p.appIni)||!isAbsolute(p.workPath)||!p.roots||!Object.keys(p.roots).length||Object.values(p.roots).some(path=>typeof path!=='string'||!isAbsolute(path))||!Array.isArray(p.checkStopped)||!Array.isArray(p.start)||p.allowServicePause!==undefined&&typeof p.allowServicePause!=='boolean')throw restoreFail('invalid_gitea_profile');
  if(!p.coffee||!Array.isArray(p.coffee.configurationFiles)||!p.coffee.configurationFiles.length||p.coffee.configurationFiles.some(path=>typeof path!=='string'||!isAbsolute(path)||!Object.values(p.roots).some(root=>inside(root,path)))||!Array.isArray(p.coffee.bindings)||!p.coffee.bindings.length||p.coffee.bindings.some(b=>!/^\d+$/.test(b.accountId)||!['gitea-'+b.accountId,'__legacy_default__'].includes(b.scope)||!isAbsolute(b.projects))||new Set(p.coffee.bindings.map(b=>b.accountId)).size!==p.coffee.bindings.length||new Set(p.coffee.bindings.map(b=>b.scope)).size!==p.coffee.bindings.length||new Set(p.coffee.bindings.map(b=>resolve(b.projects))).size!==p.coffee.bindings.length)throw restoreFail('coffee_recovery_mapping_required');
  const roots=Object.values(p.roots);for(let a=0;a<roots.length;a++)for(let b=a+1;b<roots.length;b++)if(inside(roots[a],roots[b])||inside(roots[b],roots[a]))throw restoreFail('overlapping_gitea_roots');
  return p;
 }
 private async version(p:GiteaBackupProfile){try{const result=await execute(p.binary,['--version'],{timeout:10000,maxBuffer:8192});if(!result.stdout.includes('gitea version '+p.version+' '))throw Error();}catch{throw restoreFail('gitea_version_mismatch');}}
 private async validateSource(p:GiteaBackupProfile){
  await this.version(p);for(const path of p.coffee.configurationFiles){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw restoreFail('coffee_configuration_missing');}
  const text=await readFile(p.appIni,'utf8'),settings=new Map<string,string>();let section='';
  for(const raw of text.split('\n')){const line=raw.trim();if(!line||/^[#;]/.test(line))continue;const heading=/^\[([^\]]+)\]$/.exec(line);if(heading){section=heading[1].toLowerCase();continue;}const pair=/^([^=]+)=(.*)$/.exec(line);if(pair)settings.set(section+'.'+pair[1].trim().toUpperCase(),pair[2].trim().replace(/^"(.*)"$/,'$1'));}
  if(settings.get('database.DB_TYPE')!=='sqlite3')throw restoreFail('gitea_database_requires_qualified_export');
  if([...settings].some(([key,value])=>key.endsWith('.STORAGE_TYPE')&&value&&value!=='local'))throw restoreFail('gitea_external_storage_unmapped');
  const data=resolve(p.workPath,settings.get('server.APP_DATA_PATH')??'data');
  const configured=(key:string,fallback:string)=>{const value=(settings.get(key)??fallback).replaceAll('%(APP_DATA_PATH)s',data);if(value.includes('%('))throw restoreFail('gitea_path_configuration');return resolve(p.workPath,value);};
  const required=[p.appIni,data,dirname(configured('database.PATH',join(data,'gitea.db'))),configured('repository.ROOT',join(data,'gitea-repositories')),configured('attachment.PATH',join(data,'attachments')),configured('lfs.PATH',join(data,'lfs')),configured('packages.PATH',join(data,'packages')),configured('picture.AVATAR_UPLOAD_PATH',join(data,'avatars')),configured('picture.REPOSITORY_AVATAR_UPLOAD_PATH',join(data,'repo-avatars')),configured('repo-archive.PATH',join(data,'repo-archive')),configured('actions.artifacts.PATH',join(data,'actions_artifacts')),configured('actions_log.PATH',join(data,'actions_log'))];
  for(const [key,value]of settings)if(key.endsWith('_URI')&&value.startsWith('file:'))required.push(value.slice(5));
  if(required.some(path=>!Object.values(p.roots).some(root=>inside(root,path))))throw restoreFail('gitea_storage_root_missing');
 }
 private async stopIfNeeded(p:GiteaBackupProfile){try{await run(p.checkStopped);return false;}catch{if(!p.allowServicePause||!p.stop)throw restoreFail('gitea_maintenance_window_required');await run(p.stop);await run(p.checkStopped);return true;}}
 async status(){
  const restores=[];for(const name of await readdir(this.root).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;}))if(/^restore-[a-f0-9-]{36}\.json$/.test(name))restores.push(this.public(await readJson(join(this.root,name))));
  const last=await readJson(join(this.root,'last.json')).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  const points=await this.options.repository.archivePoints('gitea');
  try{const profile=await this.profile();return {configured:true,version:profile.version,allowServicePause:profile.allowServicePause===true,points,restores,last};}catch{return {configured:false,errorCode:'gitea_configuration_unavailable',points,restores,last};}
 }

 async backup(requestId?:string){
  return restoreLock(this.root,async()=>{
   const id=requestId??randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw restoreFail('invalid_operation');
   const old=(await this.options.repository.archivePoints('gitea')).find(job=>job.id===id&&job.state==='succeeded');if(old){await durableJson(join(this.root,'last.json'),{id,state:'succeeded',captureAt:old.points[0]?.captureAt,finishedAt:old.finishedAt});return old;}
   await durableJson(join(this.root,'last.json'),{id,state:'running',startedAt:new Date().toISOString()});
   try{const p=await this.profile();await this.validateSource(p);
   const stage=join(this.root,id),archive=join(stage,'archive');await mkdir(stage,{recursive:true,mode:0o700});
   if(!await exists(join(archive,'archive.json'))){
    if(await exists(archive))throw restoreFail('gitea_capture_interrupted');
    const paused=await this.stopIfNeeded(p);
    try{await createStateArchive({destination:archive,kind:'gitea',version:p.version,roots:p.roots,recovery:{giteaProfile:p},assertQuiescent:()=>run(p.checkStopped)});}finally{if(paused)await run(p.start);}
   }
   const result=await this.options.repository.backupArchive('gitea',archive,id);
   await durableJson(join(this.root,'last.json'),{id,state:result.state,captureAt:result.points[0]?.captureAt,finishedAt:new Date().toISOString()});
   // Only discard our exact verified temporary image, never unknown material.
   try{const manifest=await verifyStateArchive(archive);if(sha(JSON.stringify(manifest))===result.points[0]?.manifestSha256&&(await readdir(stage)).length===1)await rm(stage,{recursive:true});}catch{await durableJson(join(this.root,'last.json'),{id,state:result.state,captureAt:result.points[0]?.captureAt,finishedAt:new Date().toISOString(),warning:'staging_cleanup_pending'});}
   return result;
   }catch(error){await durableJson(join(this.root,'last.json'),{id,state:'failed',errorCode:error instanceof BackupError?error.code:'gitea_backup_failed',finishedAt:new Date().toISOString()});throw error;}
  });
 }
 private planPath(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw restoreFail('invalid_operation');return join(this.root,'restore-'+id+'.json');}
 private digest(plan:GiteaRestorePlan){return sha(JSON.stringify({id:plan.id,jobId:plan.jobId,profile:plan.profile,actions:plan.actions}));}
 private public(plan:GiteaRestorePlan){return {id:plan.id,jobId:plan.jobId,state:plan.state,digest:plan.digest,errorCode:plan.errorCode,serviceState:plan.serviceState,targets:plan.actions.map(action=>({path:action.target,replaces:Boolean(action.before),...(action.before?{previousData:action.source}:{})})),done:plan.done};}
 async preview(jobId:string,input:{recoveryPackage?:string;mode?:'missing-only'|'replace'}={}){
  return restoreLock(this.root,async()=>{
   const profile=await this.profile();await this.version(profile);const id=randomUUID(),stage=join(this.root,'restore-'+id);await mkdir(stage,{mode:0o700});const extraction=join(stage,'extracted');
   const pin=await this.options.repository.pinRecoveryJob(jobId,{operationId:id,revision:1,recoveryPackage:input.recoveryPackage});
   await this.options.repository.withRecoveryPins([pin.id],async()=>this.options.repository.extractArchive(jobId,extraction,input.recoveryPackage));const archive=join(extraction,'archive'),manifest=await verifyStateArchive(archive);
   if(manifest.kind!=='gitea'||manifest.version!==profile.version||JSON.stringify((manifest.recovery?.giteaProfile as GiteaBackupProfile|undefined)?.coffee)!==JSON.stringify(profile.coffee)||JSON.stringify(Object.entries(manifest.roots).sort())!==JSON.stringify(Object.entries(profile.roots).sort()))throw restoreFail('gitea_restore_profile_changed');
   const actions:RootAction[]=[];
   for(const [label,target] of Object.entries(manifest.roots)){
    const parent=await parentIdentity(dirname(target));const current=await exists(target)?await lstat(target):undefined;
    if(current&&input.mode!=='replace')throw restoreFail('service_target_exists');if(current?.isSymbolicLink())throw restoreFail('service_target_changed');
    if(current)await run(profile.checkStopped);
    const staging=await mkdtemp(join(dirname(target),'.coffee-gitea-restore-')),source=join(staging,'data');await cp(join(archive,label),source,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});await syncTree(source);await syncDir(staging);
    const info=await lstat(source);actions.push({source,target,dev:info.dev,ino:info.ino,digest:await treeDigest(source),parent,...(current?{before:{dev:current.dev,ino:current.ino,digest:await treeDigest(target)}}:{})});
   }
   const plan:GiteaRestorePlan={pinId:pin.id,schema:1,id,jobId,state:'staged',digest:'',profile,actions,done:[]};plan.digest=this.digest(plan);await durableJson(this.planPath(id),plan);return this.public(plan);
  });
 }
 async confirm(id:string,digest:string){
  return restoreLock(this.root,async()=>{
   const plan:GiteaRestorePlan=await readJson(this.planPath(id));if(plan.digest!==digest||plan.digest!==this.digest(plan))throw restoreFail('stale_approval');if(plan.state==='completed'){if(plan.pinId)await this.options.repository.releaseRecoveryPin(plan.pinId,id,1);return this.public(plan);}
   await this.version(plan.profile);if(!plan.publicationComplete)await this.stopIfNeeded(plan.profile);plan.state='publishing';await durableJson(this.planPath(id),plan);
   try{
    for(const action of plan.actions){
     if(JSON.stringify(await parentIdentity(dirname(action.target)))!==JSON.stringify(action.parent))throw restoreFail('service_target_parent_changed');
     const current=await exists(action.target)?await lstat(action.target):undefined;
     if(current&&current.dev===action.dev&&current.ino===action.ino){if(!plan.publicationComplete&&await treeDigest(action.target)!==action.digest)throw restoreFail('service_target_changed');}
     else{
      if(plan.publicationComplete)throw restoreFail('service_target_changed');
      if(current?.isSymbolicLink()||current&&(!action.before||current.dev!==action.before.dev||current.ino!==action.before.ino||await treeDigest(action.target)!==action.before.digest)||!current&&action.before)throw restoreFail('service_target_changed');
      const source=await lstat(action.source);if(source.dev!==action.dev||source.ino!==action.ino||await treeDigest(action.source)!==action.digest)throw restoreFail('stage_changed');
      try{execFileSync('/usr/bin/python3',['-c',"import ctypes,os,sys;l=ctypes.CDLL(None,use_errno=True);r=l.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),int(sys.argv[3]));e=ctypes.get_errno();sys.exit(0) if r==0 else (_ for _ in ()).throw(OSError(e,os.strerror(e)))",action.source,action.target,action.before?'2':'1'],{timeout:10000,stdio:'ignore'});}catch{throw restoreFail('service_publish_failed');}
      await syncDir(dirname(action.target));await syncDir(dirname(action.source));
     }
     if(!plan.done.includes(action.target))plan.done.push(action.target);await durableJson(this.planPath(id),plan);
    }
    plan.publicationComplete=true;await durableJson(this.planPath(id),plan);
    await run(plan.profile.start);plan.serviceState='start-requested';
    if(plan.profile.url){let healthy=false;for(let n=0;n<100;n++){try{const response=await fetch(new URL('api/v1/version',plan.profile.url.endsWith('/')?plan.profile.url:plan.profile.url+'/'),{signal:AbortSignal.timeout(1000),redirect:'error'});if(response.ok&&(await response.json()).version===plan.profile.version){healthy=true;break;}}catch{/* bounded local startup */}await new Promise(resolve=>setTimeout(resolve,100));}if(!healthy)throw restoreFail('gitea_start_unverified');plan.serviceState='healthy';}
    plan.state='completed';delete plan.errorCode;await durableJson(this.planPath(id),plan);if(plan.pinId)await this.options.repository.releaseRecoveryPin(plan.pinId,id,1);return this.public(plan);
   }catch(error){plan.state='failed';plan.errorCode=error instanceof BackupError?error.code:'gitea_restore_failed';await durableJson(this.planPath(id),plan);throw error;}
  });
 }
}
