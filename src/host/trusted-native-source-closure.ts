import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {trustedSourcePhysicalFence} from './trusted-source-authority.js';
import {physicalFenceCoversCustody} from './physical-writer-fence.js';
import {Workspaces} from './workspaces.js';
import {PiNativeRecoveryAdapter} from './pi-recovery.js';
import {CodexNativeRecoveryAdapter,codexStore} from './codex-recovery.js';
import {CombinedNativeRecoveryAdapter} from './combined-recovery.js';
import {GroupedRecoveryAdapter,type GroupedRecoveryMember} from './grouped-recovery.js';
import {BackupError,type CaptureLease,type NativeRecoveryGroup,type WriterAdmissionFence} from './backup.js';
import {normalizeUsername} from '../shared/identity.js';
import {LEGACY_BACKUP_SCOPE} from './backup.js';
import {historySourceEngine} from './native-binding-history.js';

/** Trusted main configuration, not a browser-selected adapter or source path. */
export interface TrustedNativeSourceScope {
 scope:string;workspaces:Workspaces;
 pi?:{sessionDir:string;agentDir:string;immutablePackages?:Record<string,string>};
 codex?:{home:string;sqliteHome?:string;environmentSqliteHome?:string;version:string;nativeArgs?:readonly string[]};
}
export interface TrustedNativeStore {
 scope:string;engine:'pi'|'codex';roots:string[];bindings:string[];
}
const fail=()=>new BackupError('closure_incomplete','The configured native source graph is not complete');

/** Construct the actual pinned recovery adapters. The authority supplies its
 * code-owned held-cut root assertion; callers cannot replace native validation
 * with a successful callback or a caller-authored recovery-group object. */
export async function materializeTrustedNativeSource(options:{
 groupId:string;scopes:readonly TrustedNativeSourceScope[];fence:WriterAdmissionFence;
 lease:CaptureLease;maxBytes?:number;maxFiles?:number;assertRoots:(paths:readonly string[])=>void;
}):Promise<{group:NativeRecoveryGroup;stores:TrustedNativeStore[]}> {
 if(!options.scopes.length||new Set(options.scopes.map(scope=>scope.scope)).size!==options.scopes.length)throw fail();
 const adapters=new Map<string,CombinedNativeRecoveryAdapter>(),paths=new Map<string,{pi?:string[];codex?:string[]}>();
 for(const scope of options.scopes){
  options.lease.assertValid();
  if(scope.scope!==LEGACY_BACKUP_SCOPE&&normalizeUsername(scope.scope)!==scope.scope||!(scope.workspaces instanceof Workspaces)||scope.workspaces.backupWriterFence!==options.fence||!physicalFenceCoversCustody(trustedSourcePhysicalFence(options.fence),scope.workspaces.backupGitCustody))throw fail();
  const roots:{pi?:string[];codex?:string[]}={};
  if(scope.pi)roots.pi=[scope.pi.sessionDir,scope.pi.agentDir];
  if(scope.codex){const native=await codexStore<{nativeHome:string;sqliteHome:string}>({operation:'roots',home:scope.codex.home,sqliteHome:scope.codex.sqliteHome,environmentSqliteHome:scope.codex.environmentSqliteHome});roots.codex=[native.nativeHome,native.sqliteHome];}
  for(const path of [scope.workspaces.root,...roots.pi??[],...roots.codex??[]])if(resolve(path)!==path||await realpath(path)!==path)throw fail();
  options.assertRoots([scope.workspaces.root,...roots.pi??[],...roots.codex??[]]);paths.set(scope.scope,roots);
  const sourceCustody=async()=>{options.lease.assertValid();options.assertRoots([scope.workspaces.root,...roots.pi??[],...roots.codex??[]]);return {known:true};};
  const pi=scope.pi?new PiNativeRecoveryAdapter({scope:scope.scope,workspaces:scope.workspaces,...scope.pi,fence:options.fence,sourceCustody}):undefined;
  const codex=scope.codex?new CodexNativeRecoveryAdapter({scope:scope.scope,workspaces:scope.workspaces,codexHome:scope.codex.home,sqliteHome:scope.codex.sqliteHome,environmentSqliteHome:scope.codex.environmentSqliteHome,cliVersion:scope.codex.version,nativeArgs:scope.codex.nativeArgs,fence:options.fence,sourceCustody}):undefined;
  adapters.set(scope.scope,new CombinedNativeRecoveryAdapter({workspaces:scope.workspaces,pi,codex,fence:options.fence}));
 }
 const inventory=async()=>{
  const members:GroupedRecoveryMember[]=[];
  for(const scope of options.scopes){for(const task of (await scope.workspaces.list()).conversations){
   if(task.workspaceRemoved||task.cleanupStarted||!['pi','codex'].includes(task.engine??'pi'))continue;
   options.assertRoots([task.cwd,task.taskRoot??task.cwd]);
   members.push({scope:scope.scope,taskId:task.id,engine:task.engine??'pi'});
  }}
  return members;
 };
 const members=await inventory();if(!members.length)throw fail();
 const grouped=new GroupedRecoveryAdapter({groupId:options.groupId,fence:options.fence,maxBytes:options.maxBytes,maxFiles:options.maxFiles,inventory,resolve:(scope,taskId)=>adapters.get(scope)!.resolve(scope,taskId)});
 const header=await grouped.resolve(members[0].scope,members[0].taskId);if(!header.materialize)throw fail();const group=await header.materialize(options.lease);options.lease.assertValid();
 const stores:TrustedNativeStore[]=[];
 for(const scope of options.scopes)for(const engine of ['pi','codex'] as const){
  const roots=paths.get(scope.scope)?.[engine];if(!roots)continue;const bindings=new Set<string>();
  for(const member of group.members.filter(member=>member.scope===scope.scope)){
   const history=group.sources.find(source=>source.owner?.scope===member.scope&&source.owner.taskId===member.taskId&&source.recoveryKey==='native-history/engine-bindings-v1');
   if(history){if(!history.data)throw fail();const descriptor=JSON.parse(Buffer.from(history.data).toString('utf8'));for(const binding of descriptor.bindings[engine])bindings.add(binding);}
   else if(member.engine===engine)for(const binding of member.nativeBindings)bindings.add(binding);
  }
  if(bindings.size)stores.push({scope:scope.scope,engine,roots,bindings:[...bindings].sort()});
 }
 for(const source of group.sources){if(!historySourceEngine(source.recoveryKey))throw fail();if(source.path)options.assertRoots([source.path]);}
 await group.validate();options.lease.assertValid();return {group,stores};
}
