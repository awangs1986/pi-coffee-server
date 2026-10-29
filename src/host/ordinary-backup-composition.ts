import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {readNativeSourceHandoff} from './native-source-handoff.js';
import type {NativeAgentFactory} from './native/factory.js';
import type {BackupBrokerContext} from './backup-key-protocol.js';
import type {Conversation} from './workspaces.js';
import type {TrustedNativeSourceScope} from './trusted-native-source-closure.js';
import {open,lstat,realpath,mkdir} from 'node:fs/promises';
import {isAbsolute,resolve,join,relative} from 'node:path';
import {BackupError,type BackupCoordinator} from './backup.js';
import {NativeWriterCustody} from './native-custody.js';
import {PhysicalWriterFence} from './physical-writer-fence.js';
import {ManagedPublicationGate} from './managed-publication-gate.js';
import {TrustedSourceAuthority} from './trusted-source-authority.js';
import {TrustedSealedCheckpointSource} from './trusted-sealed-source.js';

export interface OrdinaryBackupProfile {
 schema:1;root:string;configuration:string;graph:string;sourceSocket:string;sourcePolicy:string;
 enrollment:{mode:'none'}|{mode:'fresh'|'existing';actor:string};
}
const refused=()=>new BackupError('ordinary_backup_configuration_invalid','Ordinary backup requires a private explicit source profile');
const canonical=(value:unknown):value is string=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
const under=(parent:string,path:string)=>path===parent||(!relative(parent,path).startsWith('..')&&!isAbsolute(relative(parent,path)));
async function privateJson(path:string,maximum=65536){
 if(!canonical(path)||await realpath(path)!==path)throw refused();const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o077)||info.size>maximum)throw refused();const buffer=Buffer.alloc(maximum+1),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead!==info.size)throw refused();return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));}finally{await file.close();}
}
export async function loadOrdinaryBackupProfile(path:string):Promise<OrdinaryBackupProfile>{
 const value=await privateJson(path);if(!value||value.schema!==1||Object.keys(value).some(key=>!['schema','root','configuration','graph','sourceSocket','sourcePolicy','enrollment'].includes(key))||!['root','configuration','graph','sourceSocket','sourcePolicy'].every(key=>canonical(value[key]))||!value.enrollment||!['fresh','existing','none'].includes(value.enrollment.mode)||Object.keys(value.enrollment).some(key=>!['mode','actor'].includes(key))||value.enrollment.mode!=='none'&&(typeof value.enrollment.actor!=='string'||!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value.enrollment.actor))||value.enrollment.mode==='none'&&value.enrollment.actor!==undefined)throw refused();return value;
}
/** Composition of actual ordinary custody, physical exclusion and owner authority.
 * No synthetic quiescent probe or caller-supplied qualification can enter this path.
 * Existing roots and restarted enrollments remain unknown until separately certified. */
export class OrdinaryBackupComposition {
 private source?:TrustedSealedCheckpointSource;
 private scopes:TrustedNativeSourceScope[]=[];private factories=new Map<string,NativeAgentFactory>();private closing=new AbortController();private nextAudit=0;private qualifying?:Promise<void>;private coordinator?:BackupCoordinator;
 private checkpointRoot?:string;private limits:{maxBytes?:number;maxFiles?:number;captureTimeoutMs?:number}={};
 private constructor(readonly profile:OrdinaryBackupProfile,readonly groupId:string,readonly custody:NativeWriterCustody,readonly physical:PhysicalWriterFence,readonly publicationGate:ManagedPublicationGate,readonly authority:TrustedSourceAuthority,private authorized:(actor:string)=>Promise<boolean>){}
 get fence(){return this.authority.writerFence('host');}
 static async open(profile:OrdinaryBackupProfile,backupRoot:string,context?:BackupBrokerContext){
  if(!canonical(backupRoot))throw refused();const config=await privateJson(profile.configuration);
  if(!config||typeof config.groupId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(config.groupId)||!config.owner||typeof config.owner.administrator!=='string'||!Array.isArray(config.roots)||config.roots.some((root:any)=>!canonical(root?.path)||under(root.path,backupRoot)||under(backupRoot,root.path)))throw refused();
  await mkdir(profile.root,{recursive:true,mode:0o700});const info=await lstat(profile.root);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)||await realpath(profile.root)!==profile.root)throw refused();
  const publicationGate=new ManagedPublicationGate({path:join(profile.root,'publication.json'),groupId:config.groupId,restoreRoot:join(backupRoot,'restore-runtime')}),lock=join(profile.root,'group.lock'),custody=new NativeWriterCustody(join(profile.root,'custody'),{lock}),physical=new PhysicalWriterFence({lock,custody,publicationGate});
  const authorized=async(actor:string):Promise<boolean>=>{
   try{
    if(!context||actor!==context.actor||actor!==config.owner.administrator||!Number.isSafeInteger(context.authorityRevision)||context.authorityRevision<1)return false;
    const policy=await privateJson(profile.sourcePolicy,131072),currentGraph=await privateJson(profile.graph),currentConfig=await privateJson(profile.configuration),grant=policy.actors&&Object.hasOwn(policy.actors,actor)?policy.actors[actor]:undefined;
    if(policy.schema!==1||policy.revision!==context.authorityRevision||policy.administrator!==actor||currentConfig.owner?.administrator!==actor||grant?.role!=='administrator'||!Array.isArray(grant.scopes)||!Array.isArray(policy.scopes)||!Array.isArray(currentGraph.roots)||currentGraph.groupId!==config.groupId)return false;
    return [context.dataScope,...currentGraph.roots.map((root:{scope:string})=>root.scope)].every(scope=>typeof scope==='string'&&policy.scopes.includes(scope)&&grant.scopes.includes(scope));
   }catch{return false;}
  };
  const authority=await TrustedSourceAuthority.open({root:join(profile.root,'enrollment'),configuration:profile.configuration,graph:profile.graph,fence:physical,authorize:authorized});
  if(profile.enrollment.mode==='fresh')try{await authority.enrollFresh(profile.enrollment.actor,[{id:'host',pid:process.pid}]);}catch{/* Enrollment failure does not disable ordinary tasks or repository extraction. */}
  return new OrdinaryBackupComposition(profile,config.groupId,custody,physical,publicationGate,authority,authorized);
 }
 registerScope(scope:TrustedNativeSourceScope,factory:NativeAgentFactory){if(this.scopes.some(item=>item.scope===scope.scope))throw refused();this.scopes.push(scope);this.factories.set(scope.scope,factory);}
 createCoordinator(checkpointRoot:string,limits:{maxBytes?:number;maxFiles?:number;captureTimeoutMs?:number}={}){
  if(this.coordinator)throw refused();this.checkpointRoot=checkpointRoot;this.limits=limits;
  const coordinator=this.authority.createNativeCoordinator({producer:'host',scopes:this.scopes,checkpointRoot,...limits});
  const capture=coordinator.capture.bind(coordinator);coordinator.capture=async(...args)=>{await this.ensureQualified();return capture(...args);};
  this.coordinator=coordinator;return coordinator;
 }
 /** Existing witnesses are reused first. A missing lifecycle may be established
  * only by the actual factory's bounded, owned native audit connection. */
 async ensureQualified():Promise<void>{
  if(this.closing.signal.aborted||this.profile.enrollment.mode!=='existing'||!this.coordinator||!this.checkpointRoot||(await this.authority.qualification()).state!=='unknown')return;
  if(this.qualifying)return this.qualifying;
  const actor=this.profile.enrollment.actor;if(!await this.authorized(actor))return;
  const enroll=async()=>{this.closing.signal.throwIfAborted();const handoff=await readNativeSourceHandoff({custody:this.custody,fence:this.physical});await this.authority.qualifyExisting(actor,{producer:'host',handoff,scopes:this.scopes,checkpointRoot:this.checkpointRoot!,...this.limits});this.coordinator!.refreshStatusInventory();};
  this.qualifying=(async()=>{
   try{await enroll();return;}catch{/* A missing witness can require a cold audit. */}
   if(this.closing.signal.aborted||Date.now()<this.nextAudit)return;this.nextAudit=Date.now()+5000;
   const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),Math.min(this.limits.captureTimeoutMs??30000,30000)),signal=AbortSignal.any([timeout.signal,this.closing.signal]);
   try{
    const audited=new Set<string>();
    for(const scope of this.scopes){
     signal.throwIfAborted();const factory=this.factories.get(scope.scope);if(!factory)throw refused();
     const tasks=(await scope.workspaces.list()).conversations.filter(task=>!task.workspaceRemoved&&!task.cleanupStarted&&['pi','codex'].includes(task.engine??'pi'));
     for(const engine of ['pi','codex'] as const){
      const store=scope[engine];if(!store)continue;const key=engine+JSON.stringify(store);if(audited.has(key))continue;
      for(const task of tasks.filter(task=>this.auditCandidate(task,engine))){
       signal.throwIfAborted();
       try{await factory.auditNativeHistory(task.id,{engine,signal});audited.add(key);break;}
       catch(error){if(!(error instanceof BackupError)||error.code!=='native_audit_unavailable')throw error;}
      }
     }
    }
    signal.throwIfAborted();if(await this.authorized(actor))await enroll();
   }catch{/* Unresolved coverage never prevents ordinary work or old-point reads. */}
   finally{clearTimeout(timer);}
  })();
  try{await this.qualifying;}finally{this.qualifying=undefined;}
 }
 private auditCandidate(task:Conversation,engine:'pi'|'codex'){
  return (task.engine??'pi')===engine||task.retainedNativeBindings?.some(binding=>binding.engine===engine)||task.takeoverSegments?.some(segment=>segment.from===engine||segment.to===engine)||Boolean(task.retainedNativeIds?.length);
 }
 /** A version subprocess is also a writer: preserve its environment and retain
  * descendant custody even if its five-second observation budget expires. */
 async codexVersion(command:string,options:{cwd:string;env:NodeJS.ProcessEnv}):Promise<string>{
  try{return await this.fence.runWriter('native',async()=>{
   const launch=await this.custody.prepare({executable:command,args:['--version']});
   return await new Promise<string>(resolve=>{
    const child=spawn(process.execPath,[launch.cliPath],{cwd:options.cwd,env:{...process.env,...options.env,...launch.env},stdio:['ignore','pipe','pipe']});
    let done=false,stdout='',bytes=0;
    const finish=(value:string)=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
    const abort=()=>{child.kill('SIGTERM');finish('unknown');};
    const timer=setTimeout(abort,5000);
    child.stdout.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>8192){abort();return;}stdout+=chunk;});
    child.stderr.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>8192)abort();});
    child.on('error',()=>finish('unknown'));child.on('close',code=>finish(code===0?stdout.trim().match(/^codex-cli (\d+\.\d+\.\d+)$/)?.[1]??'unknown':'unknown'));
   });
  });}catch{return 'unknown';}
 }
 async sourceProof(paths:readonly string[]):Promise<{known:boolean;reason?:string}>{
  try{const evidence=this.authority.verifyRoots(paths);if(evidence.groupId!==this.groupId||(await this.authority.qualification()).state!=='qualified')throw Error();return {known:true};}catch{return {known:false,reason:'Ordinary source coverage is not qualified'};}
 }
 async startSource(coordinator:BackupCoordinator,maxBytes?:number){if(this.source)throw refused();this.source=new TrustedSealedCheckpointSource({socket:this.profile.sourceSocket,policyFile:this.profile.sourcePolicy,coordinator,maxBytes});await this.source.listen();}
 async close(){this.closing.abort();await this.qualifying;await this.source?.close();await this.authority.close();}
}
