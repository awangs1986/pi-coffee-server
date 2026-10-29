import type {RepositoryRetentionPlan} from './backup-retention.js';
import {BackupExtractionStore} from './backup-extraction-store.js';
import {emitSealedCheckpoint} from './backup-checkpoint-stream.js';
import {hardenCurrentProcess,processProtection} from './linux-file-lease.js';
import {constants} from 'node:fs';import {open,lstat,realpath,readFile,rm,mkdir} from 'node:fs/promises';import {isAbsolute,resolve,join} from 'node:path';import {randomUUID} from 'node:crypto';
import {BackupError,LEGACY_BACKUP_SCOPE} from './backup.js';import {BackupRepository} from './backup-repository.js';
import {BackupBrokerError,type BackupBrokerPolicy,type BackupBrokerRequest,type BackupKeyServiceConfig,type BackupBrokerQualification,type BackupExtractionDescriptor} from './backup-key-protocol.js';import {BackupCheckpointReceiver} from './backup-checkpoint-transfer.js';
import {requestUnixPeer} from './backup-repository-client.js';
const scopeValid=(value:unknown):value is string=>typeof value==='string'&&(value===LEGACY_BACKUP_SCOPE||/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value));
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/;
interface PeerRequest extends BackupBrokerRequest {_peer:{pid:number;uid:number;gid:number};}

/** Secret-owning side only. Host clients never import this or read its root. */
export class BackupKeyService {
 private readonly repository:BackupRepository;private points=new Map<string,import('./backup.js').SealedCheckpoint>();
 private constructor(private config:BackupKeyServiceConfig){this.repository=new BackupRepository({root:join(config.privateRoot,'repository-runtime'),coordinator:{sealedCheckpoint:async(scope,taskId)=>this.points.get(scope+'/'+taskId)}});}
 static async load(path:string){const protection=hardenCurrentProcess();if(protection.dumpable!==0||protection.noNewPrivs!==1)throw new BackupBrokerError('service_boundary_unavailable');const config=await ownedJson(path) as BackupKeyServiceConfig;
  if(config.responseLimit!==undefined&&(!Number.isSafeInteger(config.responseLimit)||config.responseLimit<1024||config.responseLimit>2*1024**3)||config.trustModel!==undefined&&!['host-root','managed'].includes(config.trustModel)||config.schema!==1||config.serviceUid!==process.getuid?.()||![config.serviceUid,config.hostUid,config.sourceUid].every(uid=>Number.isSafeInteger(uid)&&uid>=0)||!['socket','privateRoot','authorityFile','sourceSocket','binary','destination','node','handler'].every(key=>typeof config[key as keyof BackupKeyServiceConfig]==='string'&&isAbsolute(config[key as keyof BackupKeyServiceConfig] as string)))throw new BackupBrokerError('service_configuration_invalid');
  const info=await lstat(config.privateRoot);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==config.serviceUid||(info.mode&0o077)||await realpath(config.privateRoot)!==resolve(config.privateRoot))throw new BackupBrokerError('service_configuration_invalid');
  return new BackupKeyService(config);
 }
 requiresSocketPeer(){return this.config.trustModel==='host-root';}
 responseLimit(){return this.config.responseLimit??1024*1024;}
 private async authorize(request:PeerRequest){
  if(!request||request.schema!==1||typeof request.id!=='string'||!uuid.test(request.id)||!request._peer||request._peer.uid!==this.config.hostUid||!Number.isSafeInteger(request._peer.pid)||request._peer.pid<1)throw new BackupBrokerError('peer_identity_mismatch');
  if(Object.keys(request).some(key=>!['schema','id','context','operation','scope','query','selection','recoveryPackage','jobId','extractionId','checkpointId','operationId','revision','ttlMs','pinId','pinIds','scopes','timeZone','retentionId','digest','_peer'].includes(key)))throw new BackupBrokerError('invalid_request');
  const policy=await ownedJson(this.config.authorityFile) as BackupBrokerPolicy,context=request.context;
  if(policy.schema!==1||!Number.isSafeInteger(policy.revision)||!scopeValid(policy.administrator)||!Array.isArray(policy.scopes)||policy.scopes.some(scope=>!scopeValid(scope))||!policy.actors||typeof policy.actors!=='object')throw new BackupBrokerError('authority_unavailable');
  if(this.config.trustModel==='host-root')await this.authorizeHostProcess(request,policy);
  if(!context||Object.keys(context).some(key=>!['actor','dataScope','authorityRevision'].includes(key))||!scopeValid(context.actor)||!scopeValid(context.dataScope)||!Number.isSafeInteger(context.authorityRevision))throw new BackupBrokerError('invalid_request');
  if(context.authorityRevision!==policy.revision)throw new BackupBrokerError('authority_stale');
  const actor=Object.hasOwn(policy.actors,context.actor)?policy.actors[context.actor]:undefined;
  if(!actor||!Array.isArray(actor.scopes)||!actor.scopes.includes(context.dataScope)||!policy.scopes.includes(context.dataScope))throw new BackupBrokerError('scope_denied');
  const scope=request.scope??context.dataScope;if(!scopeValid(scope)||!policy.scopes.includes(scope)||!actor.scopes.includes(scope))throw new BackupBrokerError('scope_denied');
  const administrator=context.actor===policy.administrator&&actor.role==='administrator';
  if(!['status','jobs','recovery-points','recovery-job','qualification','configure','backup','export-recovery','verify-recovery','rotate','recover','stage-extraction','restore-checkpoint','close-extraction','pin-recovery-job','release-recovery-pin','recovery-pins','hold-recovery-pins','retention-preview','retention-plans','retention-execute'].includes(request.operation))throw new BackupBrokerError('invalid_operation');
  if(!['status','qualification','recovery-points','recovery-job'].includes(request.operation)&&!administrator)throw new BackupBrokerError('administrator_required');
  if(!administrator&&scope!==context.dataScope)throw new BackupBrokerError('scope_denied');
  return {policy,actor,scope,administrator};
 }
 /** Operator-controlled enrollment, independent of an application actor. Same
  * UID, ancestry or a claimed body PID never grants permission to assert actors. */
 private async authorizeHostProcess(request:PeerRequest,policy:BackupBrokerPolicy){
  const clients=policy.hostClients;
  if(!Array.isArray(clients)||!clients.length||clients.length>32||clients.some(client=>!client||Object.keys(client).some(key=>!['pid','uid','boot','birth'].includes(key))||!Number.isSafeInteger(client.pid)||client.pid<1||!Number.isSafeInteger(client.uid)||client.uid<0||typeof client.boot!=='string'||!/^[a-f0-9-]{36}$/.test(client.boot)||typeof client.birth!=='string'||!/^\d+$/.test(client.birth)))throw new BackupBrokerError('host_enrollment_unavailable');
  const client=clients.find(client=>client.pid===request._peer.pid&&client.uid===request._peer.uid);if(!client)throw new BackupBrokerError('host_process_not_enrolled');
  try{
   const status=await readFile('/proc/'+client.pid+'/status','utf8'),raw=await readFile('/proc/'+client.pid+'/stat','utf8'),boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),fields=raw.slice(raw.lastIndexOf(')')+2).split(' '),uids=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
   if(!uids||uids.slice(1).some(uid=>Number(uid)!==client.uid)||['Z','X'].includes(fields[0])||fields[19]!==client.birth||boot!==client.boot)throw Error();
  }catch{throw new BackupBrokerError('host_process_not_enrolled');}
 }
 async qualification():Promise<BackupBrokerQualification>{
  const protection=processProtection(),base={serviceUid:this.config.serviceUid,sourceUid:this.config.sourceUid,hostUid:this.config.hostUid,processProtection:protection};
  if(protection.dumpable!==0||protection.noNewPrivs!==1)return {...base,state:'unavailable',reason:'service_process_unprotected'};
  if(this.config.trustModel==='host-root')return {...base,state:'qualified',trustModel:'host-root',sourceConsistency:'per-checkpoint'};
  if(this.config.serviceUid===this.config.hostUid||this.config.serviceUid===this.config.sourceUid)return {...base,state:'unavailable',reason:'service_identity_not_separate'};
  // A fresh authenticated source-owner RPC supplies mechanical admission state,
  // not a configured Boolean or persisted signature-only qualification.
  try{
   const challenge=randomUUID(),response=await requestUnixPeer(this.config.sourceSocket,this.config.sourceUid,{schema:1,id:randomUUID(),operation:'qualify-backup',challenge},5000);
   const value=response?.result??response;
   if(value.schema!==1||value.challenge!==challenge||value.enforcement!=='managed-bwrap-flock-v1'||value.admission!=='protected-only'||value.legacy!=='drained'||(!Number.isSafeInteger(value.policyRevision)||value.policyRevision<1)||!/^[0-9a-f]{64}$/.test(value.profileDigest)||value.authority?.uid!==this.config.sourceUid||!Number.isSafeInteger(value.authority.pid)||value.authority.pid<1)throw new BackupBrokerError('source_boundary_unqualified');
   const status=await readFile('/proc/'+value.authority.pid+'/status','utf8'),raw=await readFile('/proc/'+value.authority.pid+'/stat','utf8'),boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth=raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
   if(['Z','X'].includes(raw.slice(raw.lastIndexOf(')')+2).split(' ')[0])||!status.split('\n').some(line=>{if(!line.startsWith('Uid:'))return false;const ids=line.slice(4).trim().split(/\s+/).map(Number);return ids.length===4&&ids.every(uid=>uid===this.config.sourceUid);})||value.authority.birth!==birth||value.authority.boot!==boot)throw new BackupBrokerError('source_boundary_unqualified');
   return {...base,state:'qualified',sourceRevision:value.policyRevision};
  }catch{return {...base,state:'unavailable',reason:'source_boundary_unqualified'};}
 }
 async dispatch(raw:unknown,emit?:(frame:unknown)=>Promise<void>){
  const request=raw as Partial<PeerRequest>;const operation=typeof request?.operation==='string'&&['configure','backup','export-recovery','verify-recovery','rotate','recover','stage-extraction','restore-checkpoint','close-extraction','pin-recovery-job','release-recovery-pin','recovery-pins','hold-recovery-pins','retention-preview','retention-plans','retention-execute'].includes(request.operation)?request.operation:undefined;
  try{const result=await this.handle(raw,emit);if(operation)await this.audit(request,operation,'succeeded');return result;}
  catch(error){if(operation)await this.audit(request,operation,publicBrokerCode(error));throw error;}
 }
 private async audit(request:Partial<PeerRequest>,operation:string,result:string){
  const context=request.context;const entry={schema:1,operation,result,at:new Date().toISOString(),...(context&&scopeValid(context.actor)&&scopeValid(context.dataScope)?{actor:context.actor,dataScope:context.dataScope,authorityRevision:Number.isSafeInteger(context.authorityRevision)?context.authorityRevision:null}:{}),...(typeof request.id==='string'&&uuid.test(request.id)?{id:request.id}:{})};
  const file=await open(join(this.config.privateRoot,'broker-audit.jsonl'),constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{const info=await file.stat();if(info.uid!==process.getuid?.()||(info.mode&0o077)||info.nlink!==1||!info.isFile())throw new BackupBrokerError('service_audit_unavailable');await file.writeFile(JSON.stringify(entry)+'\n');await file.sync();}finally{await file.close();}
 }
 private async handle(raw:unknown,emit?:(frame:unknown)=>Promise<void>){
  const request=raw as PeerRequest,{scope,administrator}=await this.authorize(request);
  const qualification=await this.qualification();
  if(request.operation==='qualification')return qualification;
  if(request.operation==='status'){const state=await this.repository.status(scope);return {...state,qualification};}
  if(request.operation==='jobs')return (await this.repository.jobs()).filter(job=>job.selection?.some(item=>item.scope===scope)||job.points.some(item=>item.scope===scope)).map(job=>({...job,selection:job.selection.filter(item=>item.scope===scope),points:job.points.filter(item=>item.scope===scope)}));
  if(request.operation==='recovery-points')return this.repository.recoveryPoints(scope,request.query);
  if(request.operation==='recovery-job'){if(typeof request.jobId!=='string'||!uuid.test(request.jobId))throw new BackupBrokerError('invalid_recovery_job');return (await this.repository.recoveryJob(request.jobId,scope))??null;}
  if(!administrator)throw new BackupBrokerError('administrator_required');
  if(qualification.state!=='qualified')throw new BackupBrokerError('activation_unqualified');
  await this.authorize(request); // Re-read current policy after external qualification.
  switch(request.operation){
   case 'pin-recovery-job':{
    if(typeof request.jobId!=='string'||!uuid.test(request.jobId)||typeof request.operationId!=='string'||!uuid.test(request.operationId)||!Number.isSafeInteger(request.revision))throw new BackupBrokerError('invalid_recovery_pin');
    const policy=(await this.authorize(request)).policy,job=(await this.repository.jobs()).find(row=>row.id===request.jobId);if(!job)throw new BackupBrokerError('unknown_snapshot');this.requireScopes(policy,request,job.points.map(point=>point.scope));
    return this.repository.pinRecoveryJob(request.jobId,{operationId:request.operationId,revision:request.revision!,ttlMs:request.ttlMs});
   }
   case 'release-recovery-pin':{
    if(typeof request.pinId!=='string'||!uuid.test(request.pinId)||typeof request.operationId!=='string'||!uuid.test(request.operationId)||!Number.isSafeInteger(request.revision))throw new BackupBrokerError('invalid_recovery_pin');
    const policy=(await this.authorize(request)).policy,pin=(await this.repository.recoveryPins()).find(row=>row.id===request.pinId);if(!pin)throw new BackupBrokerError('invalid_recovery_pin');this.requireScopes(policy,request,pin.scopes);await this.repository.releaseRecoveryPin(request.pinId,request.operationId,request.revision!);return {released:true};
   }
   case 'recovery-pins':{const policy=(await this.authorize(request)).policy;return (await this.repository.recoveryPins(scope)).filter(pin=>pin.scopes.every(value=>policy.scopes.includes(value)&&policy.actors[request.context.actor].scopes.includes(value)));}
   case 'hold-recovery-pins':{
    if(!emit||!Array.isArray(request.pinIds)||!request.pinIds.length||request.pinIds.length>1000||request.pinIds.some(id=>typeof id!=='string'||!uuid.test(id)))throw new BackupBrokerError('invalid_recovery_pin');
    const policy=(await this.authorize(request)).policy,pins=await this.repository.recoveryPins();for(const id of request.pinIds){const pin=pins.find(pin=>pin.id===id);if(!pin)throw new BackupBrokerError('invalid_recovery_pin');this.requireScopes(policy,request,pin.scopes);}
    await this.audit(request,'recovery-pin-lease-start','succeeded');
    return this.repository.withRecoveryPins(request.pinIds,async lease=>{
     const deadline=Date.now()+30*60000;await emit({schema:1,id:request.id,ok:true,result:{lease:true,pinIds:request.pinIds,deadlineAt:new Date(deadline).toISOString()}});
     while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));lease.assertHeld();await this.authorize(request);await emit({schema:1,id:request.id,kind:'pin-heartbeat'});}return new BackupKeyStreamComplete();
    });
   }
   case 'retention-preview':{const policy=(await this.authorize(request)).policy;if(!Array.isArray(request.scopes)||request.scopes.some(scope=>typeof scope!=='string'))throw new BackupBrokerError('invalid_retention');this.requireScopes(policy,request,request.scopes);return this.retentionView(await this.repository.previewRetention({scopes:request.scopes,timeZone:request.timeZone}),policy,request);}
   case 'retention-plans':{const policy=(await this.authorize(request)).policy;return (await this.repository.retentionPlans(scope)).filter(plan=>plan.scopes.every(value=>policy.scopes.includes(value)&&policy.actors[request.context.actor].scopes.includes(value))).map(plan=>this.retentionView(plan,policy,request));}
   case 'retention-execute':{if(typeof request.retentionId!=='string'||!uuid.test(request.retentionId)||!Number.isSafeInteger(request.revision)||typeof request.digest!=='string')throw new BackupBrokerError('invalid_retention');const policy=(await this.authorize(request)).policy,plan=(await this.repository.retentionPlans()).find(plan=>plan.id===request.retentionId);if(!plan)throw new BackupBrokerError('invalid_retention');this.requireScopes(policy,request,plan.scopes);return this.retentionView(await this.repository.executeRetention(plan.id,request.revision!,request.digest),policy,request);}
   case 'configure':await this.repository.configure({destination:this.config.destination,binary:this.config.binary});return {configured:true};
   case 'export-recovery':return this.repository.exportRecoveryPackage();
   case 'verify-recovery':if(typeof request.recoveryPackage!=='string'||request.recoveryPackage.length>8192)throw new BackupBrokerError('invalid_recovery_copy');await this.repository.verifyRecoveryPackage(request.recoveryPackage);return {verified:true};
   case 'rotate':await this.repository.rotateRecoveryKey();return {rotated:true};
   case 'recover':await this.repository.recoverInterruptedOperation();return {reconciled:true};
   case 'stage-extraction':{
    if(typeof request.jobId!=='string'||!uuid.test(request.jobId)||request.recoveryPackage!==undefined&&(typeof request.recoveryPackage!=='string'||request.recoveryPackage.length>8192))throw new BackupBrokerError('invalid_restore_request');
    const policy=(await this.authorize(request)).policy,job=(await this.repository.jobs()).find(job=>job.id===request.jobId&&job.state==='succeeded');if(!job)throw new BackupBrokerError('unknown_snapshot');
    const grants=policy.actors[request.context.actor].scopes;if(job.points.some(point=>!grants.includes(point.scope)||!policy.scopes.includes(point.scope)))throw new BackupBrokerError('scope_denied');
    const handle=await new BackupExtractionStore(this.config.privateRoot).create(request.id),root=handle.root;
    try{
     await this.repository.extract(request.jobId,join(root,'material'),request.recoveryPackage);await this.authorize(request);
     const checkpoints=new Map<string,BackupExtractionDescriptor['checkpoints'][number]>();for(const point of job.points)checkpoints.set(point.checkpointId,{checkpointId:point.checkpointId,manifestSha256:point.manifestSha256,scope:point.scope,taskId:point.taskId});
     const descriptor:BackupExtractionDescriptor={extractionId:request.id,jobId:request.jobId,expiresAt:new Date(Date.now()+5*60*1000).toISOString(),scopes:[...new Set(job.points.map(point=>point.scope))],checkpoints:[...checkpoints.values()]};
     if(descriptor.checkpoints.length>1000)throw new BackupBrokerError('extraction_capacity');
     await writeReceipt(join(root,'receipt.json'),{...descriptor,actor:request.context.actor,dataScope:request.context.dataScope,authorityRevision:request.context.authorityRevision});await handle.assertHeld();return descriptor;
    }catch(error){await handle.remove();throw error;}finally{handle.lease.release();}
   }
   case 'restore-checkpoint':{
    const handle=await this.extraction(request,'shared'),{root,receipt}=handle;try{if(typeof request.checkpointId!=='string'||!uuid.test(request.checkpointId)||!emit)throw new BackupBrokerError('invalid_restore_request');const point=receipt.checkpoints.find(point=>point.checkpointId===request.checkpointId);if(!point)throw new BackupBrokerError('unknown_checkpoint');
    await emitSealedCheckpoint(join(root,'material',point.checkpointId),emit,point.manifestSha256);await handle.assertHeld();return new BackupKeyStreamComplete();}finally{handle.lease.release();}
   }
   case 'close-extraction':{
    const handle=await this.extraction(request,'exclusive');try{await handle.remove();return {closed:true};}finally{handle.lease.release();}
   }
   case 'backup':{
    if(!Array.isArray(request.selection)||request.selection.length<1||request.selection.length>1000||request.selection.some(item=>!item||Object.keys(item).some(key=>!['scope','taskId','expectedCheckpointId'].includes(key))||!scopeValid(item.scope)||!['string'].includes(typeof item.taskId)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(item.taskId)||item.expectedCheckpointId!==undefined&&!uuid.test(item.expectedCheckpointId)))throw new BackupBrokerError('invalid_selection');
    if(this.config.trustModel==='host-root'&&request.selection.some(item=>!item.expectedCheckpointId))throw new BackupBrokerError('invalid_selection');
    const policy=(await this.authorize(request)).policy;const grants=policy.actors[request.context.actor].scopes;
    for(const item of request.selection)if(!policy.scopes.includes(item.scope)||!grants.includes(item.scope))throw new BackupBrokerError('scope_denied');
    const previous=(await this.repository.jobs()).find(job=>job.id===request.id);if(previous){for(const item of request.selection)if(item.expectedCheckpointId&&!previous.points.some(point=>point.scope===item.scope&&point.taskId===item.taskId&&point.checkpointId===item.expectedCheckpointId))throw new BackupBrokerError('operation_conflict');return this.repository.backup(request.selection.map(({scope,taskId})=>({scope,taskId})),undefined,request.id);}
    const ingestRoot=join(this.config.privateRoot,'ingest',request.id);let remaining=1024**3;
    try{
     for(const item of request.selection){const cached=this.points.get(item.scope+'/'+item.taskId);if(cached){if(item.expectedCheckpointId&&cached.manifest.checkpointId!==item.expectedCheckpointId)throw new BackupBrokerError('checkpoint_identity_conflict');continue;}const receiver=new BackupCheckpointReceiver({root:ingestRoot,socket:this.config.sourceSocket,sourceUid:this.config.sourceUid,allowedScopes:grants.filter(grant=>policy.scopes.includes(grant)),maxBytes:remaining,...(this.config.trustModel==='host-root'?{directPeer:true,request:{schema:1,id:randomUUID(),operation:'export-checkpoint',context:request.context,scope:item.scope,taskId:item.taskId,expectedCheckpointId:item.expectedCheckpointId}}:{})});const point=await receiver.receive(item.scope,item.taskId,item.expectedCheckpointId);remaining-=point.manifest.totalBytes;if(remaining<0)throw new BackupBrokerError('source_transfer_limit');for(const member of point.manifest.members)this.points.set(member.scope+'/'+member.taskId,point);}
     await this.authorize(request);const current=await this.qualification();if(current.state!=='qualified'||this.config.trustModel!=='host-root'&&current.sourceRevision!==qualification.sourceRevision)throw new BackupBrokerError('activation_unqualified');
     return await this.repository.backup(request.selection.map(({scope,taskId})=>({scope,taskId})),undefined,request.id);
    }finally{await rm(ingestRoot,{recursive:true,force:true});this.points.clear();}
   }
   default:throw new BackupBrokerError('invalid_operation');
  }
 }
 private retentionView(plan:RepositoryRetentionPlan,policy:BackupBrokerPolicy,request:PeerRequest){
  const allowed=(scope:string)=>policy.scopes.includes(scope)&&policy.actors[request.context.actor].scopes.includes(scope),pins=plan.pins.filter(pin=>pin.scopes.every(allowed)),pinIds=new Set(pins.map(pin=>pin.id));
  return {...plan,pins,keep:plan.keep.map(row=>({...row,reasons:row.reasons.filter(reason=>'scope' in reason?allowed(reason.scope):'pinId' in reason?pinIds.has(reason.pinId):false)})).filter(row=>row.reasons.length),remove:plan.remove.filter(row=>row.scopes.every(allowed))};
 }
 private requireScopes(policy:BackupBrokerPolicy,request:PeerRequest,scopes:string[]){if(!scopes.length||scopes.some(scope=>!scopeValid(scope)||!policy.scopes.includes(scope)||!policy.actors[request.context.actor].scopes.includes(scope)))throw new BackupBrokerError('scope_denied');}
 private async extraction(request:PeerRequest,mode:'shared'|'exclusive'){
  if(typeof request.extractionId!=='string'||!uuid.test(request.extractionId))throw new BackupBrokerError('invalid_restore_request');
  const handle=await new BackupExtractionStore(this.config.privateRoot).open(request.extractionId,mode);try{const receipt=await handle.receipt() as BackupExtractionDescriptor&{actor:string;dataScope:string;authorityRevision:number};
   if(receipt.extractionId!==request.extractionId||receipt.actor!==request.context.actor||receipt.dataScope!==request.context.dataScope||receipt.authorityRevision!==request.context.authorityRevision||!Number.isFinite(Date.parse(receipt.expiresAt))||Date.parse(receipt.expiresAt)<Date.now()||!Array.isArray(receipt.checkpoints)||!Array.isArray(receipt.scopes))throw new BackupBrokerError('extraction_expired');
   const policy=(await this.authorize(request)).policy;if(receipt.scopes.some(scope=>!policy.scopes.includes(scope)||!policy.actors[request.context.actor].scopes.includes(scope)))throw new BackupBrokerError('scope_denied');return {...handle,receipt};
  }catch(error){handle.lease.release();throw error;}
 }

}
export class BackupKeyStreamComplete {}
export async function ownedJson(path:string,maxBytes=65536){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)||info.nlink!==1||info.size>maxBytes||await realpath(path)!==resolve(path))throw new BackupBrokerError('service_configuration_invalid');const buffer=Buffer.alloc(maxBytes+1),result=await file.read(buffer,0,buffer.length,0);if(result.bytesRead!==info.size||result.bytesRead>maxBytes)throw new BackupBrokerError('service_configuration_invalid');return JSON.parse(buffer.subarray(0,result.bytesRead).toString('utf8'));}finally{await file.close();}}
export function publicBrokerCode(error:unknown){return error instanceof BackupBrokerError||error instanceof BackupError?error.code:'broker_failed';}

async function writeReceipt(path:string,value:unknown){const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}}
