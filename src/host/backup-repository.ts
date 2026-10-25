import {recoveryPointPage,type RecoveryPointQuery} from './recovery-point-catalog.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {planRetention,type RecoveryPin,type RecoveryPinLease,type RepositoryRetentionPlan,type RetentionSnapshot} from './backup-retention.js';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants,createReadStream} from 'node:fs';
import {mkdir,lstat,realpath,open,readFile,readdir,rename,rm,mkdtemp,statfs} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {BackupCoordinator,BackupError,verifySealedCheckpoint,type CheckpointManifest} from './backup.js';

/** Reviewed upstream artifact, never PATH discovery or an executable supplied by a browser. */
export const RESTIC_PIN={version:'0.19.1',platform:'linux/amd64',source:'https://github.com/restic/restic/releases/tag/v0.19.1',archiveSha256:'f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c',sha256:'20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'} as const;
interface DestinationIdentity {path:string;dev:number;ino:number;uid:number;mount:string;}
interface RepositoryConfig {schema:1;binary:string;destination:DestinationIdentity;repository?:DestinationIdentity;repositoryId:string;keyId:string;enabled:boolean;exported:boolean;passwordName?:string;retiredKeys?:{id:string;passwordName:string}[];}
export interface BackupSelection {scope:string;taskId:string;}
export interface RepositoryPoint extends BackupSelection {checkpointId:string;captureAt:string;engine:string;manifestSha256:string;}
export interface RepositoryJob {schema:1;id:string;state:'running'|'succeeded'|'failed';startedAt:string;finishedAt?:string;selection:BackupSelection[];points:RepositoryPoint[];snapshotId?:string;dataBlobs?:number;verification:'none'|'repository-read';errorCode?:string;retiredAt?:string;retentionId?:string;}
interface RecoveryPackage {schema:1;backend:typeof RESTIC_PIN;repositoryId:string;keyId:string;password:string;repository:{path:string;identity:DestinationIdentity};recoveryInstructions:string[];}
const idPattern=/^[0-9a-f-]{36}$/;
const fail=(code:string)=>new BackupError(code,({offline_copy_required:'Export and independently verify the offline recovery copy before enabling backup',destination_unavailable:'Configured backup destination is unavailable',destination_changed:'Configured backup destination identity changed',repository_busy:'Another backup repository operation owns the lock',backend_untrusted:'Restic executable does not match the reviewed pin',checkpoint_unavailable:'No intact sealed checkpoint is available',recovery_verification_failed:'Offline recovery copy could not decrypt this repository',repository_failed:'Backup repository operation failed; previous successful points retained'} as Record<string,string>)[code]??'Backup repository operation refused');

/** Trusted Host/independent CLI job boundary. Only BackupCoordinator supplies data;
 * no live source paths, repository passwords or native stores enter browser status. */
export class BackupRepository {
 readonly root:string;private now:()=>number;private lockNonce?:string;
 constructor(private options:{root:string;coordinator:Pick<BackupCoordinator,'sealedCheckpoint'>;now?:()=>number;timeoutMs?:number;onRetentionPhase?:(event:{id:string;phase:'forgotten'|'pruned'|'journaled'})=>Promise<void>}){this.root=resolve(options.root);this.now=options.now??Date.now;}
 private async initialize(){await mkdir(this.root,{recursive:true,mode:0o700});await privateDirectory(this.root);await mkdir(join(this.root,'jobs'),{recursive:true,mode:0o700});await privateDirectory(join(this.root,'jobs'));}
 private async config():Promise<RepositoryConfig>{await this.initialize();return JSON.parse(await privateText(join(this.root,'config.json'),32768));}
 private async saveConfig(config:RepositoryConfig){await atomicJson(this.root,'config.json',config);}
 async configure(input:{destination:string;binary:string}):Promise<void>{
  await this.initialize();await this.exclusive(async()=>{
   if(await exists(join(this.root,'config.json'))||await exists(join(this.root,'password')))throw fail('already_configured');
   if(!isAbsolute(input.destination)||!isAbsolute(input.binary))throw fail('invalid_configuration');
   const destination=await identify(input.destination);await validateBinary(input.binary);
   if(overlap(this.root,destination.path))throw fail('invalid_configuration');
   // Existing non-empty repositories cannot be silently adopted under a new key.
   if(await exists(join(destination.path,'repository')))throw fail('repository_exists');
   const password=randomBytes(48).toString('base64url'),keyId=randomUUID();
   await atomicText(this.root,'password',password+'\n');
   const provisional:RepositoryConfig={schema:1,binary:resolve(input.binary),destination,repositoryId:'',keyId,enabled:false,exported:false};
   try{await capacity(destination.path,0);await this.command(provisional,['init','--repository-version','2','--json']);provisional.repository=await identify(join(destination.path,'repository'));const config=JSON.parse(await this.command(provisional,['cat','config']));if(!/^[0-9a-f]{64}$/.test(config.id))throw fail('repository_failed');provisional.repositoryId=config.id;await this.saveConfig(provisional);await this.audit('repository-created',keyId);}
   catch{throw fail('repository_failed');} // Retain secret after partial init: never overwrite it on retry.
  });
 }
 async exportRecoveryPackage():Promise<string>{return this.exclusive(async()=>{const config=await this.config();await this.destination(config);const password=(await privateText(join(this.root,config.passwordName??'password'),1024)).trim();const recovery:RecoveryPackage={schema:1,backend:RESTIC_PIN,repositoryId:config.repositoryId,keyId:config.keyId,password,repository:{path:join(config.destination.path,'repository'),identity:config.destination},recoveryInstructions:['Keep this package offline and private. Loss of every copy makes encrypted data unrecoverable.','Use the pinned Restic artifact and a private password file containing the password field. Never put the password on a command line.','The verify-offline CLI checks this copy against the repository without the original runtime secret. A relocated disk still must decrypt the recorded repository ID.','Restore first to a new isolated private directory. Current Host authorization and native adapter compatibility are separate requirements.']};config.exported=true;await this.saveConfig(config);await this.audit('recovery-export',config.keyId);return JSON.stringify(recovery);});}
 static async verifyOfflineRecoveryPackage(copy:string,options:{destination:string;binary:string}):Promise<{repositoryId:string;verification:'repository-read'}>{
  if(typeof copy!=='string'||copy.length>8192)throw fail('recovery_verification_failed');let value;try{value=JSON.parse(copy);}catch{throw fail('recovery_verification_failed');}if(!value||typeof value!=='object')throw fail('recovery_verification_failed');const recovery=parseRecovery(copy,{repositoryId:value.repositoryId,keyId:value.keyId} as RepositoryConfig);
  if(!/^[0-9a-f]{64}$/.test(recovery.repositoryId)||!idPattern.test(recovery.keyId)||!isAbsolute(options.destination)||!isAbsolute(options.binary))throw fail('recovery_verification_failed');
  const temp=await mkdtemp(join(tmpdir(),'coffee-offline-check-'));
  try{
   const repository=new BackupRepository({root:temp,coordinator:new BackupCoordinator({root:join(temp,'unused-checkpoints')})});
   const destination=await identify(options.destination),config:RepositoryConfig={schema:1,binary:options.binary,destination,repository:await identify(join(destination.path,'repository')),repositoryId:recovery.repositoryId,keyId:recovery.keyId,enabled:false,exported:true};
   await repository.withRecoveryPassword(recovery,async passwordFile=>{const actual=JSON.parse(await repository.command(config,['cat','config'],{passwordFile,isolated:true}));if(actual.id!==recovery.repositoryId)throw fail('recovery_verification_failed');await repository.command(config,['check','--read-data'],{passwordFile,isolated:true});});
   return {repositoryId:recovery.repositoryId,verification:'repository-read'};
  }catch{throw fail('recovery_verification_failed');}finally{await rm(temp,{recursive:true,force:true});}
 }
 async verifyRecoveryPackage(copy:string):Promise<void>{await this.exclusive(async()=>{
  const config=await this.config();if(!config.exported)throw fail('offline_copy_required');
  try{parseRecovery(copy,config);await this.destination(config);await BackupRepository.verifyOfflineRecoveryPackage(copy,{destination:config.destination.path,binary:config.binary});}
  catch{await this.audit('recovery-verification-failed',config.keyId);throw fail('recovery_verification_failed');}
  await this.retirePreviousKeys(config);config.enabled=true;await this.saveConfig(config);await this.audit('recovery-verified',config.keyId);
 });}
 /** Rotate the repository access key, retaining the old key until the new
  * independently exported copy verifies. Password selection changes atomically. */
 async rotateRecoveryKey():Promise<void>{await this.exclusive(async()=>{
  const config=await this.config();if(!config.enabled||config.retiredKeys?.length)throw fail('offline_copy_required');
  const keys: {id:string;current:boolean}[]=JSON.parse(await this.command(config,['key','list','--json']));
  const old=keys.find(key=>key.current);if(!old||!/^[0-9a-f]{64}$/.test(old.id))throw fail('repository_failed');
  const keyId=randomUUID(),passwordName='password-'+keyId;await atomicText(this.root,passwordName,randomBytes(48).toString('base64url')+'\n');
  await this.audit('recovery-rotation-started',keyId);await this.command(config,['key','add','--new-password-file',join(this.root,passwordName)]);
  // Ensure newly generated credentials really open this repository before the
  // durable pointer changes. A crash before it keeps the previous usable key.
  const actual=JSON.parse(await this.command(config,['cat','config'],{passwordFile:join(this.root,passwordName)}));if(actual.id!==config.repositoryId)throw fail('repository_failed');
  config.retiredKeys=[{id:old.id,passwordName:config.passwordName??'password'}];config.passwordName=passwordName;config.keyId=keyId;config.enabled=false;config.exported=false;await this.saveConfig(config);await this.audit('recovery-rotation',keyId);
 });}
 private async retirePreviousKeys(config:RepositoryConfig){
  for(const retired of config.retiredKeys??[]){
   const keys:{id:string;current:boolean}[]=JSON.parse(await this.command(config,['key','list','--json']));
   const key=keys.find(key=>key.id===retired.id);if(key?.current)throw fail('repository_failed');
    if(key){await this.audit('recovery-key-revocation-started',retired.id);await this.command(config,['key','remove',retired.id]);}
   await this.audit('recovery-key-revoked',retired.id);
   if(retired.passwordName!==config.passwordName&&/^password(?:-[0-9a-f-]{36})?$/.test(retired.passwordName))await rm(join(this.root,retired.passwordName),{force:true});
  }
  config.retiredKeys=[];
 }
 async backup(selection:BackupSelection[],signal?:AbortSignal,requestId?:string):Promise<RepositoryJob>{
  await this.initialize();return this.exclusive(async()=>{
   const config=await this.config();if(!config.enabled)throw fail('offline_copy_required');
   if(requestId&&!idPattern.test(requestId))throw fail('invalid_operation');
   if(requestId){const existing=(await this.jobs()).find(job=>job.id===requestId);if(existing){if(JSON.stringify(existing.selection)!==JSON.stringify(selection))throw fail('operation_conflict');if(existing.state==='succeeded')return existing;throw fail(existing.state==='running'?'operation_uncertain':existing.errorCode??'repository_failed');}}
   const job:RepositoryJob={schema:1,id:requestId??randomUUID(),state:'running',startedAt:this.time(),selection:selection.map(({scope,taskId})=>({scope,taskId})),points:[],verification:'none'};
   await this.saveJob(job);
   try{
    await this.destination(config);if(!selection.length||selection.length>100000)throw fail('invalid_selection');
    const directories=new Map<string,string>(),manifests:CheckpointManifest[]=[];
    for(const item of selection){signal?.throwIfAborted();const point=await this.options.coordinator.sealedCheckpoint(item.scope,item.taskId);if(!point)throw fail('checkpoint_unavailable');if(overlap(point.directory,config.destination.path)||overlap(point.directory,this.root))throw fail('invalid_configuration');if(!directories.has(point.manifest.checkpointId)){directories.set(point.manifest.checkpointId,point.directory);manifests.push(point.manifest);}}
    for(const manifest of manifests)for(const member of manifest.members){if(!job.points.some(p=>p.scope===member.scope&&p.taskId===member.taskId&&p.checkpointId===manifest.checkpointId))job.points.push({scope:member.scope,taskId:member.taskId,engine:member.engine,manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),checkpointId:manifest.checkpointId,captureAt:manifest.captureAt});}
    await this.saveJob(job);await capacity(config.destination.path,manifests.reduce((total,manifest)=>total+manifest.totalBytes,0));
    const parents=new Set([...directories.values()].map(dirname));if(parents.size!==1)throw fail('invalid_checkpoint_store');
    const output=await this.command(config,['backup','--json','--host','pi-coffee','--tag','pi-coffee-v1','--tag','job:'+job.id,'--',...directories.keys()],{cwd:[...parents][0],signal});
    const summary=output.trim().split('\n').map(line=>JSON.parse(line)).find(line=>line.message_type==='summary');
    if(!summary||!/^[0-9a-f]{8,64}$/.test(summary.snapshot_id))throw fail('repository_failed');
    // Full authenticated repository read, not merely exit=0 or a snapshot name.
    await this.command(config,['check','--read-data'],{signal});
    await this.destination(config);
    const snapshots=JSON.parse(await this.command(config,['snapshots','--json',summary.snapshot_id],{signal}));
    const snapshot=snapshots.find((s:{id:string;tags?:string[]})=>s.id.startsWith(summary.snapshot_id)&&s.tags?.includes('job:'+job.id));if(!snapshot)throw fail('repository_failed');
    await this.verifySnapshot(config,snapshot.id,job.points,signal);
    job.snapshotId=snapshot.id;job.dataBlobs=summary.data_blobs;job.verification='repository-read';job.state='succeeded';job.finishedAt=this.time();await this.saveJob(job);return job;
   }catch(error){job.state='failed';job.errorCode=error instanceof BackupError?error.code:signal?.aborted?'job_cancelled':'repository_failed';job.finishedAt=this.time();await this.saveJob(job);throw fail(job.errorCode);}
  });
 }
 async jobs():Promise<RepositoryJob[]>{await this.initialize();const jobs:RepositoryJob[]=[];for(const name of await readdir(join(this.root,'jobs'))){if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;try{const job=JSON.parse(await privateText(join(this.root,'jobs',name),32*1024*1024));if(job.schema===1&&Array.isArray(job.points))jobs.push(job);}catch{/* Corrupt journal never becomes success. */}}return jobs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id));}
 async recoveryPoints(scope:string,query:RecoveryPointQuery={}){return recoveryPointPage(await this.jobs(),scope,query);}
 async recoveryJob(jobId:string,scope?:string):Promise<RepositoryJob|undefined>{await this.initialize();if(!idPattern.test(jobId))throw fail('invalid_recovery_job');let job:RepositoryJob;try{job=JSON.parse(await privateText(join(this.root,'jobs',jobId+'.json'),32*1024*1024));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}if(job.schema!==1||job.id!==jobId||job.state!=='succeeded'||job.verification!=='repository-read'||job.retiredAt||!Array.isArray(job.points)||!Array.isArray(job.selection)||!job.snapshotId)return undefined;if(scope===undefined)return job;const points=job.points.filter(point=>point.scope===scope);return points.length?{...job,points,selection:job.selection.filter(item=>item.scope===scope)}:undefined;}
 async status(scope:string){
  let config:RepositoryConfig|undefined;try{config=await this.config();}catch{/* No key/path details in status. */}
  const jobs=(await this.jobs()).filter(job=>job.selection?.some(item=>item.scope===scope)||job.points.some(point=>point.scope===scope)).map(job=>({...job,selection:job.selection?.filter(item=>item.scope===scope)??[],points:job.points.filter(point=>point.scope===scope)}));
  const points=new Map<string,RepositoryPoint>();for(const job of jobs.filter(j=>j.state==='succeeded'&&!j.retiredAt))for(const point of job.points)if(!points.has(point.taskId)||point.captureAt>points.get(point.taskId)!.captureAt)points.set(point.taskId,point);
  return {configured:Boolean(config),enabled:config?.enabled??false,offlineCopyExported:config?.exported??false,backend:{name:'restic',version:RESTIC_PIN.version},jobs:jobs.slice(0,20),points:[...points.values()].map(p=>({...p,ageMs:Math.max(0,this.now()-Date.parse(p.captureAt)),stale:this.now()-Date.parse(p.captureAt)>86400000})),excludedEngines:['claude','cursor','grok']};
 }
 async pinRecoveryJob(jobId:string,input:{operationId:string;revision:number;ttlMs?:number}):Promise<RecoveryPin>{
  return this.exclusive(async()=>{
   await this.initializeRetention();const ttl=input.ttlMs??86400000;if(!idPattern.test(jobId)||!idPattern.test(input.operationId)||!Number.isSafeInteger(input.revision)||input.revision<1||!Number.isSafeInteger(ttl)||ttl<1000||ttl>86400000)throw fail('invalid_recovery_pin');
   const job=(await this.jobs()).find(row=>row.id===jobId&&row.state==='succeeded'&&row.verification==='repository-read'&&!row.retiredAt);if(!job?.snapshotId||!job.points.length)throw fail('unknown_snapshot');
   const catalog=await this.retentionCatalog(await this.config());if(!catalog.some(row=>row.snapshotId===job.snapshotId))throw fail('unknown_snapshot');
   const hash=createHash('sha256').update(input.operationId+':'+input.revision+':'+jobId).digest('hex'),id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
   let previous:RecoveryPin|undefined;try{previous=JSON.parse(await privateText(join(this.root,'recovery-pins',id+'.json'),32768));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const pin:RecoveryPin={schema:1,id,operationId:input.operationId,revision:input.revision,jobId,snapshotId:job.snapshotId,scopes:[...new Set(job.points.map(point=>point.scope))].sort(),createdAt:previous?.createdAt??this.time(),expiresAt:new Date(this.now()+ttl).toISOString()};
   await atomicJson(join(this.root,'recovery-pins'),id+'.json',pin);return pin;
  });
 }
 async releaseRecoveryPin(id:string,operationId:string,revision:number):Promise<void>{await this.exclusive(async()=>{await this.initializeRetention();if(!idPattern.test(id))throw fail('invalid_recovery_pin');const pin=JSON.parse(await privateText(join(this.root,'recovery-pins',id+'.json'),32768)) as RecoveryPin;if(pin.operationId!==operationId||pin.revision!==revision)throw fail('recovery_pin_conflict');pin.releasedAt??=this.time();await atomicJson(join(this.root,'recovery-pins'),id+'.json',pin);});}
 async recoveryPins(scope?:string):Promise<RecoveryPin[]>{await this.initializeRetention();const {pins,leases}=await this.retentionPins();try{return pins.filter(pin=>scope===undefined||pin.scopes.includes(scope));}finally{for(const lease of leases)lease.release();}}
 /** Stable shared pin authorities survive expiry while the bounded active job
  * holds its FDs. Permanent authority files are never removed with receipts. */
 async withRecoveryPins<T>(ids:string[],run:(lease:RecoveryPinLease)=>Promise<T>):Promise<T>{
  await this.initializeRetention();if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>!idPattern.test(id)))throw fail('invalid_recovery_pin');
  const leases:FileLease[]=[],deadline=Date.now()+30*60000;
  try{for(const id of [...ids].sort()){const lease=acquireFileLease(join(this.root,'recovery-pin-locks',id+'.lock'),'shared');if(!lease)throw fail('recovery_pin_busy');leases.push(lease);const pin=JSON.parse(await privateText(join(this.root,'recovery-pins',id+'.json'),32768)) as RecoveryPin;if(pin.id!==id||pin.releasedAt||Date.parse(pin.expiresAt)<=this.now())throw fail('recovery_pin_expired');}
   const held={assertHeld:()=>{if(Date.now()>=deadline)throw fail('recovery_pin_lease_expired');for(const lease of leases)lease.assertHeld();}};held.assertHeld();const result=await run(held);held.assertHeld();return result;
  }finally{for(const lease of leases)lease.release();}
 }
 async previewRetention(input:{scopes:string[];timeZone?:string}):Promise<RepositoryRetentionPlan>{return this.exclusive(async()=>{
  await this.initializeRetention();let config:RepositoryConfig;try{config=await this.config();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw fail('repository_unconfigured');throw error;}if(!config.enabled)throw fail('offline_copy_required');const catalog=await this.retentionCatalog(config),{pins,leases}=await this.retentionPins();
  try{const decision=planRetention(catalog,pins,{...input,now:this.now()}),plan:RepositoryRetentionPlan={...decision,schema:1,id:randomUUID(),revision:1,createdAt:this.time(),repositoryId:config.repositoryId,catalogDigest:retentionDigest({catalog,pins}),digest:'',state:'previewed',phase:'preview',deletedSnapshotIds:[]};plan.digest=this.retentionApprovalDigest(plan);await this.saveRetention(plan);return plan;}finally{for(const lease of leases)lease.release();}
 });}
 async retentionPlans(scope?:string):Promise<RepositoryRetentionPlan[]>{await this.initializeRetention();const result:RepositoryRetentionPlan[]=[];for(const name of await readdir(join(this.root,'retention'))){if(!idPattern.test(name.slice(0,-5))||!name.endsWith('.json'))continue;const plan=JSON.parse(await privateText(join(this.root,'retention',name),32*1024*1024)) as RepositoryRetentionPlan;if(scope===undefined||plan.scopes.includes(scope))result.push(plan);}return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async executeRetention(id:string,revision:number,digest:string):Promise<RepositoryRetentionPlan>{return this.exclusive(async()=>{
  await this.initializeRetention();if(!idPattern.test(id))throw fail('invalid_retention');const plan=JSON.parse(await privateText(join(this.root,'retention',id+'.json'),32*1024*1024)) as RepositoryRetentionPlan;
  if(revision!==plan.revision||digest!==plan.digest||plan.digest!==this.retentionApprovalDigest(plan))throw fail('stale_retention_approval');if(plan.state==='completed')return plan;
  const config=await this.config();if(!config.enabled||config.repositoryId!==plan.repositoryId)throw fail('retention_repository_changed');const catalog=await this.retentionCatalog(config),{pins,leases}=await this.retentionPins();
  try{
   const current=planRetention(catalog,pins,{scopes:plan.scopes,timeZone:plan.timeZone,now:this.now()});
   if(plan.phase==='preview'&&retentionDigest({catalog,pins})!==plan.catalogDigest)throw fail('retention_plan_stale');
   const remaining=plan.remove.map(row=>row.snapshotId).filter(snapshot=>catalog.some(row=>row.snapshotId===snapshot));
   // After an interrupted deletion, new references can protect remaining targets.
   // Exact approved identities never expand to newly eligible snapshots.
   if(remaining.some(snapshot=>!current.remove.some(row=>row.snapshotId===snapshot)))throw fail('retention_plan_stale');
   plan.state='executing';delete plan.errorCode;plan.phase='forgetting';await this.saveRetention(plan);
   if(remaining.length)await this.command(config,['forget',...remaining]);
   plan.deletedSnapshotIds=plan.remove.map(row=>row.snapshotId).sort();await this.saveRetention(plan);for(const job of await this.jobs())if(job.snapshotId&&plan.deletedSnapshotIds.includes(job.snapshotId)){job.retiredAt??=this.time();job.retentionId=plan.id;await this.saveJob(job);}await this.options.onRetentionPhase?.({id:plan.id,phase:'forgotten'});
   plan.phase='pruning';await this.saveRetention(plan);if(plan.remove.length)await this.command(config,['prune']);await this.command(config,['check','--read-data']);await this.options.onRetentionPhase?.({id:plan.id,phase:'pruned'});
   plan.phase='journal';await this.saveRetention(plan);for(const job of await this.jobs())if(job.snapshotId&&plan.deletedSnapshotIds.includes(job.snapshotId)){job.retiredAt??=this.time();job.retentionId=plan.id;await this.saveJob(job);}await this.options.onRetentionPhase?.({id:plan.id,phase:'journaled'});
   plan.phase='complete';plan.state='completed';plan.finishedAt=this.time();await this.saveRetention(plan);return plan;
  }catch(error){plan.state='failed';plan.errorCode=error instanceof BackupError?error.code:'retention_failed';await this.saveRetention(plan);throw error;}finally{for(const lease of leases)lease.release();}
 });}
 private async initializeRetention(){await this.initialize();for(const name of ['recovery-pins','recovery-pin-locks','retention']){await mkdir(join(this.root,name),{mode:0o700,recursive:true});await privateDirectory(join(this.root,name));}}
 private async retentionCatalog(config:RepositoryConfig):Promise<RetentionSnapshot[]>{const snapshots=JSON.parse(await this.command(config,['snapshots','--json'])),jobs=await this.jobs();if(!Array.isArray(snapshots)||snapshots.length>100000)throw fail('retention_catalog_invalid');return snapshots.map(row=>{if(!row||typeof row.id!=='string'||!/^[0-9a-f]{64}$/.test(row.id))throw fail('retention_catalog_invalid');const matches=jobs.filter(job=>job.snapshotId===row.id&&!job.retiredAt),points=new Map<string,RepositoryPoint>();for(const job of matches)for(const point of job.points)points.set(point.scope+'/'+point.taskId+'/'+point.checkpointId,point);return {snapshotId:row.id,jobIds:matches.map(job=>job.id).sort(),verified:matches.length>0&&matches.every(job=>job.state==='succeeded'&&job.verification==='repository-read'),points:[...points.values()].sort((a,b)=>(a.scope+'/'+a.taskId).localeCompare(b.scope+'/'+b.taskId))};}).sort((a,b)=>a.snapshotId.localeCompare(b.snapshotId));}
 private async retentionPins(){const pins:RecoveryPin[]=[],leases:FileLease[]=[];try{for(const name of (await readdir(join(this.root,'recovery-pins'))).sort()){if(!name.endsWith('.json')||!idPattern.test(name.slice(0,-5)))continue;const lease=acquireFileLease(join(this.root,'recovery-pin-locks',name.slice(0,-5)+'.lock'),'exclusive');if(lease)leases.push(lease);const pin=JSON.parse(await privateText(join(this.root,'recovery-pins',name),32768)) as RecoveryPin;if(pin.schema!==1||pin.id!==name.slice(0,-5)||!idPattern.test(pin.operationId)||!Array.isArray(pin.scopes)||!Number.isFinite(Date.parse(pin.expiresAt)))throw fail('recovery_pin_invalid');pins.push({...pin,activeLease:!lease});if(pins.length>100000)throw fail('recovery_pin_capacity');}return {pins,leases};}catch(error){for(const lease of leases)lease.release();throw error;}}
 private retentionApprovalDigest(plan:RepositoryRetentionPlan){return retentionDigest({schema:plan.schema,id:plan.id,revision:plan.revision,createdAt:plan.createdAt,repositoryId:plan.repositoryId,catalogDigest:plan.catalogDigest,policy:plan.policy,timeZone:plan.timeZone,scopes:plan.scopes,keep:plan.keep,remove:plan.remove,pins:plan.pins});}
 private async saveRetention(plan:RepositoryRetentionPlan){await atomicJson(join(this.root,'retention'),plan.id+'.json',plan);}
 /** Extract to a NEW private directory only. Publication/restore authorization is a separate Host operation. */
 async extract(jobId:string,destination:string,copy?:string,signal?:AbortSignal):Promise<void>{await this.exclusive(async()=>{
  if(!idPattern.test(jobId)||!isAbsolute(destination)||await exists(destination))throw fail('invalid_restore_target');
  const config=await this.config(),job=(await this.jobs()).find(j=>j.id===jobId&&j.state==='succeeded'&&!j.retiredAt);if(!job?.snapshotId)throw fail('unknown_snapshot');
  if(overlap(destination,config.destination.path)||overlap(destination,this.root))throw fail('invalid_restore_target');
  await mkdir(destination,{mode:0o700});await privateDirectory(destination);
  const extract=async(passwordFile?:string)=>{await this.command(config,['restore',job.snapshotId!,'--target',destination,'--verify'],{passwordFile,isolated:Boolean(copy),signal});await this.verifyExtraction(destination,job.points);};
  if(copy)await this.withRecoveryPassword(parseRecovery(copy,config),extract);else await extract();
 });}
 /** Explicit worker restart recovery. Native unlock removes only Restic's stale locks;
  * it never uses --no-lock or --remove-all and cannot evict a live operation. */
 async recoverInterruptedOperation():Promise<void>{
  await this.initialize();const lock=join(this.root,'operation-lock');
  // Preserve unknown authorities from older candidates; new recovery ownership
  // is a permanent kernel flock and needs no PID/age-based lock deletion.
  if(await exists(join(this.root,'recovery-lock')))throw fail('repository_busy');
  const recoveryLease=acquireFileLease(join(this.root,'recovery.lock'),'exclusive');if(!recoveryLease)throw fail('repository_busy');
  try{
   if(await exists(lock)){
    const info=await privateDirectory(lock),owner=JSON.parse(await privateText(join(lock,'owner.json'),8192));
    if(!Number.isSafeInteger(owner.pid)||!owner.identity||!owner.nonce||['unknown-live',owner.identity].includes(await processIdentity(owner.pid)??'dead'))throw fail('repository_busy');
    if(await exists(join(lock,'command.json'))){const command=JSON.parse(await privateText(join(lock,'command.json'),8192));if(command.nonce!==owner.nonce||!command.identity||['unknown-live',command.identity].includes(await processIdentity(command.pid)??'dead')||processGroupExists(command.pid))throw fail('repository_busy');}
    const current=await privateDirectory(lock),receipt=JSON.parse(await privateText(join(lock,'owner.json'),8192));if(current.ino!==info.ino||current.dev!==info.dev||receipt.nonce!==owner.nonce)throw fail('repository_busy');
    await rm(lock,{recursive:true});await syncDirectory(this.root);
   }
   await this.exclusive(async()=>{
    const config=await this.config();await this.command(config,['unlock']);
    for(const job of (await this.jobs()).filter(j=>j.state==='running')){
     const matches=JSON.parse(await this.command(config,['snapshots','--json','--tag','job:'+job.id]));
     // A killed controller can have completed a snapshot but not its success journal.
     // Reconcile that snapshot before any retry; only an authenticated full read can publish it.
     if(matches.length===1&&job.points.length){await this.command(config,['check','--read-data']);await this.verifySnapshot(config,matches[0].id,job.points);job.state='succeeded';job.snapshotId=matches[0].id;job.verification='repository-read';}
     else{job.state='failed';job.errorCode='job_interrupted';}
     job.finishedAt=this.time();await this.saveJob(job);
    }
    await this.audit('worker-reconciled',config.keyId);
   });
  }finally{recoveryLease.release();}
 }
 private async verifyExtraction(destination:string,points:RepositoryPoint[]){
  const ids=new Map(points.map(point=>[point.checkpointId,point.manifestSha256]));
  const entries=await readdir(destination);if(entries.length!==ids.size||entries.some(entry=>!ids.has(entry)))throw fail('snapshot_incomplete');
  for(const [id,digest] of ids){const manifest=await verifySealedCheckpoint(join(destination,id),digest);if(manifest.checkpointId!==id)throw fail('snapshot_incomplete');}
 }
 private async verifySnapshot(config:RepositoryConfig,snapshotId:string,points:RepositoryPoint[],signal?:AbortSignal){
  const temp=await mkdtemp(join(tmpdir(),'coffee-snapshot-read-'));
  try{await this.command(config,['restore',snapshotId,'--target',temp,'--verify'],{signal});await this.verifyExtraction(temp,points);}
  finally{await rm(temp,{recursive:true,force:true});}
 }
 private time(){return new Date(this.now()).toISOString();}
 private async saveJob(job:RepositoryJob){await atomicJson(join(this.root,'jobs'),job.id+'.json',job);}
 private async audit(event:string,keyId:string){const file=await open(join(this.root,'audit.jsonl'),'a',0o600);try{await file.writeFile(JSON.stringify({schema:1,event,keyId,at:this.time()})+'\n');await file.sync();}finally{await file.close();}}
 private async destination(config:RepositoryConfig){let identity:DestinationIdentity;try{identity=await identify(config.destination.path);}catch{throw fail('destination_unavailable');}if(JSON.stringify(identity)!==JSON.stringify(config.destination))throw fail('destination_changed');return identity;}
 private async withRecoveryPassword<T>(recovery:RecoveryPackage,run:(path:string)=>Promise<T>):Promise<T>{const temp=await mkdtemp(join(tmpdir(),'coffee-recovery-'));try{await privateDirectory(temp);await atomicText(temp,'password',recovery.password+'\n');return await run(join(temp,'password'));}finally{await rm(temp,{recursive:true,force:true});}}
 private async command(config:RepositoryConfig,args:string[],options:{cwd?:string;passwordFile?:string;isolated?:boolean;signal?:AbortSignal}={}):Promise<string>{
  options.signal?.throwIfAborted();await validateBinary(config.binary);await this.destination(config);if(config.repository)await checkKeyEnvelopes(config.repository.path);
  const expected=config.repository??config.destination;if(config.repository&&JSON.stringify(await identify(config.repository.path))!==JSON.stringify(config.repository))throw fail('destination_changed');
  const destination=await open(expected.path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const opened=await destination.stat();if(opened.dev!==expected.dev||opened.ino!==expected.ino){await destination.close();throw fail('destination_changed');}
  // An inherited directory descriptor pins the checked destination, even if a path is swapped mid-operation.
  const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:options.isolated?dirname(options.passwordFile!):this.root,LANG:'C.UTF-8',RESTIC_PASSWORD_FILE:options.passwordFile??join(this.root,config.passwordName??'password'),RESTIC_CACHE_DIR:join(this.root,'cache'),GOMAXPROCS:'1',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??'/run/user/'+process.getuid?.(),DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS??'unix:path=/run/user/'+process.getuid?.()+'/bus'};
  try{return await new Promise<string>((resolveResult,reject)=>{
   const scope='coffee-backup-engine-'+randomUUID()+'.scope';env.PI_COFFEE_ENGINE_SCOPE=scope;
   const child=spawn('/usr/bin/systemd-run',['--user','--scope','--quiet','--collect','--expand-environment=no','--unit='+scope,'--property=MemoryMax=1G','--property=MemorySwapMax=0','--property=CPUQuota=100%','--property=TasksMax=64','--property=IOWeight=10','/usr/bin/ionice','-c3',process.execPath,new URL(import.meta.url.endsWith('.ts')?'../../dist/src/host/backup-restic-worker.js':'./backup-restic-worker.js',import.meta.url).pathname,config.binary,'--repo',config.repository?'/proc/self/fd/3':'/proc/self/fd/3/repository','--no-cache',...args],{cwd:options.cwd??this.root,env,stdio:['pipe','pipe','pipe',destination.fd],detached:true});let stdout='',size=0,stopped=false;
   const stop=()=>{stopped=true;if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{/* Already exited. */}};
   child.stdin?.on('error',stop);
   const timeout=setTimeout(stop,this.options.timeoutMs??30*60*1000);options.signal?.addEventListener('abort',stop,{once:true});
   void (async()=>{try{if(!child.pid)throw fail('repository_failed');if(this.lockNonce){const lock=join(this.root,'operation-lock');const owner=JSON.parse(await privateText(join(lock,'owner.json'),8192));if(owner.nonce!==this.lockNonce)throw fail('repository_busy');await atomicJson(lock,'command.json',{pid:child.pid,identity:await processIdentity(child.pid),nonce:this.lockNonce});}child.stdin?.end('execute\n');}catch{stop();}})();
   child.stdout?.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024)stop();else stdout+=chunk;});child.stderr?.on('data',()=>{/* Native diagnostics can include private paths; never return or persist them. */});
   child.on('error',()=>{clearTimeout(timeout);options.signal?.removeEventListener('abort',stop);reject(fail('repository_failed'));});
   child.on('close',code=>{clearTimeout(timeout);options.signal?.removeEventListener('abort',stop);if(code!==0||stopped)reject(fail(options.signal?.aborted?'job_cancelled':'repository_failed'));else resolveResult(stdout);});
  });}finally{await destination.close();}
 }
 private async exclusive<T>(run:()=>Promise<T>):Promise<T>{
  await this.initialize();const lock=join(this.root,'operation-lock');
  try{await mkdir(lock,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw fail('repository_busy');throw error;}
  const nonce=randomUUID(),identity=await privateDirectory(lock);this.lockNonce=nonce;
  try{await atomicJson(lock,'owner.json',{pid:process.pid,identity:await processIdentity(process.pid),nonce,startedAt:this.time()});await syncDirectory(this.root);return await run();}finally{const current=await privateDirectory(lock),owner=JSON.parse(await privateText(join(lock,'owner.json'),8192));if(current.ino!==identity.ino||current.dev!==identity.dev||owner.nonce!==nonce)throw fail('repository_busy');this.lockNonce=undefined;await rm(lock,{recursive:true,force:true});await syncDirectory(this.root);}
 }
}
function parseRecovery(copy:string,config:RepositoryConfig):RecoveryPackage{if(typeof copy!=='string'||copy.length>8192)throw fail('recovery_verification_failed');let value;try{value=JSON.parse(copy);}catch{throw fail('recovery_verification_failed');}if(!value||typeof value!=='object'||value.schema!==1||value.repositoryId!==config.repositoryId||value.keyId!==config.keyId||value.backend?.sha256!==RESTIC_PIN.sha256||typeof value.password!=='string'||value.password.length<32||value.password.length>512)throw fail('recovery_verification_failed');return value;}
async function privateDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path)||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw fail('unsafe_private_store');return info;}
async function privateText(path:string,max:number){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>max)throw fail('unsafe_private_store');return readFile(path,'utf8');}
async function identify(path:string):Promise<DestinationIdentity>{try{const full=resolve(path),info=await privateDirectory(full);const mounts=(await readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line=>({line,path:line.split(' ')[4].replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)))})).filter(m=>full===m.path||full.startsWith(m.path==='/'?'/':m.path+'/')).sort((a,b)=>b.path.length-a.path.length);if(!mounts.length)throw Error('No mount');return {path:full,dev:info.dev,ino:info.ino,uid:info.uid,mount:mounts[0].line};}catch{throw fail('destination_unavailable');}}
async function validateBinary(path:string){try{if(process.platform!=='linux'||process.arch!=='x64')throw Error('Unsupported platform');const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o022)!==0||await binaryDigest(path)!==RESTIC_PIN.sha256)throw Error('Pin mismatch');}catch{throw fail('backend_untrusted');}}
async function atomicText(dir:string,name:string,text:string){const temp=join(dir,randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);try{await file.writeFile(text);await file.sync();}finally{await file.close();}await rename(temp,join(dir,name));await syncDirectory(dir);}
async function atomicJson(dir:string,name:string,value:unknown){await atomicText(dir,name,JSON.stringify(value));}
async function syncDirectory(path:string){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function exists(path:string){return lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});}
function overlap(a:string,b:string){a=resolve(a);b=resolve(b);return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');}

async function binaryDigest(path:string){const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');}
async function processIdentity(pid:number){try{const stat=await readFile('/proc/'+pid+'/stat','utf8'),boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();return boot+':'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}catch{try{process.kill(pid,0);return 'unknown-live';}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return undefined;return 'unknown-live';}}}

function processGroupExists(pid:number){try{process.kill(-pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}

async function capacity(path:string,bytes:number){const info=await statfs(path);if(info.bavail*info.bsize<bytes+32*1024*1024)throw fail('destination_capacity');}

async function checkKeyEnvelopes(repository:string){
 const keys=join(repository,'keys');const info=await lstat(keys);if(!info.isDirectory()||info.isSymbolicLink())throw fail('repository_failed');
 const names=await readdir(keys);if(names.length>64)throw fail('repository_failed');
 for(const name of names){
  if(!/^[0-9a-f]{64}$/.test(name))throw fail('repository_failed');const path=join(keys,name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw fail('repository_failed');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let raw:string;try{const opened=await handle.stat();if(!opened.isFile()||opened.size>16384||opened.ino!==info.ino||opened.dev!==info.dev)throw fail('repository_failed');const bytes=Buffer.alloc(16385),result=await handle.read(bytes,0,bytes.length,0);if(result.bytesRead>16384||result.bytesRead!==opened.size)throw fail('repository_failed');raw=bytes.subarray(0,result.bytesRead).toString('utf8');}finally{await handle.close();}const key=JSON.parse(raw);
  if(key.kdf!=='scrypt'||!Number.isSafeInteger(key.N)||key.N<2||key.N>262144||(key.N&(key.N-1))!==0||!Number.isSafeInteger(key.r)||key.r<1||key.r>32||!Number.isSafeInteger(key.p)||key.p<1||key.p>16||128*key.N*key.r>128*1024*1024||key.N*key.r*key.p>16*1024*1024||typeof key.salt!=='string'||Buffer.from(key.salt,'base64').length!==64||typeof key.data!=='string'||Buffer.from(key.data,'base64').length<32||Buffer.from(key.data,'base64').length>8192)throw fail('repository_failed');
 }
}

function retentionDigest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
