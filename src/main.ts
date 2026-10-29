import {getAgentDir} from '@earendil-works/pi-coding-agent';
import {OrdinaryBackupComposition,loadOrdinaryBackupProfile} from './host/ordinary-backup-composition.js';
import {startColdEnrollmentControl} from './host/cold-enrollment-control.js';
import {createHash} from 'node:crypto';
import {ManagedPublicationGate} from './host/managed-publication-gate.js';
import {GroupedRecoveryAdapter,type GroupedRecoveryMember} from './host/grouped-recovery.js';
import {CombinedNativeRecoveryAdapter} from './host/combined-recovery.js';
import {CodexNativeRecoveryAdapter,codexStore} from './host/codex-recovery.js';
import {codexRecoveryVersion} from './host/codex-recovery-version.js';
import {AccountRecoveryCoordinator} from './host/account-recovery.js';
import {managedScopeLayout} from './host/managed-source-layout.js';
import {ManagedCheckpointRefresh} from './host/managed-checkpoint-refresh.js';
import {ManagedNativeCustody} from './host/managed-native.js';
import {ManagedWriterFence} from './host/managed-writer-fence.js';
import {ManagedLaunchPolicy,LegacyAdmissionFence} from './host/managed-launch-policy.js';
import {ManagedSourceAuthority,loadManagedSourceConfig,startManagedAdmissionControl} from './host/managed-source-authority.js';
import {BackupRepositoryClient,readBackupRepositoryClientConfig} from './host/backup-repository-client.js';
import {RestoreCoordinator,type NativeRestoreAdapter,type RestoreScope} from './host/restore.js';
import {BackupJobRunner,type BackupInventoryConnection} from './host/backup-job-runner.js';
import {BackupCoordinator,BackupError,LEGACY_BACKUP_SCOPE,type NativeRecoveryAdapter} from './host/backup.js';
import {PiNativeRecoveryAdapter} from './host/pi-recovery.js';
import {AdmissionNativeCustody} from './host/native-custody.js';
import {BackupSourceCustody} from './host/backup-source-custody.js';
import {githubOAuthOptions} from './web/github-oauth.js';
import {savedMishuScopes} from './host/mishu-recovery.js';
import {githubRenewalClient} from './host/github-renewal.js';
import {homedir} from "node:os";
import {RunnerManager} from "./host/runners.js";
import {hostSessionInstructions,accountScopeInstruction} from "./host/session-instructions.js";
import {taskRootForScope} from './host/task-storage.js';
import { NativeAgentFactory } from "./host/native/factory.js";
import { Workspaces } from "./host/workspaces.js";
import { GiteaClient } from "./host/gitea.js";
import {giteaAccountForScope} from './host/gitea-accounts.js';
import {GitHubAccounts} from "./host/github-accounts.js";
import { HostPiRuntime } from "./host/pi-runtime.js";
import { parseUserRoutes, type IdentityOptions } from "./web/identity.js";
import { readFileSync } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import {createRuntimeTemp} from "./host/runtime-temp.js";
import { dirname, join, resolve } from "node:path";
import { CodexSessionFactory } from "./host/codex-adapter.js";
import { HostServer, type UserScope } from "./host/server.js";
import { RpcPiSessionFactory, type PiSessionFactory } from "./host/pi-adapter.js";
import { DEFAULT_MAX_BATCH_BYTES, DEFAULT_MAX_FILE_BYTES, TransferServer } from "./host/transfer.js";
import { RelayServer } from "./relay/server.js";
import { normalizeUsername, parseAllowedUsers, taskNamespace } from "./shared/identity.js";
import { GiteaAuth } from "./web/auth.js";
import { WebServer } from "./web/server.js";
import {restartOptions} from './web/restart.js';

type Role = "host" | "web" | "relay" | "all";

const role = process.argv[2] ?? "all";

if (role !== "host" && role !== "web" && role !== "relay" && role !== "all") {
  console.error(`Usage: node dist/src/main.js [host|web|relay|all]`);
  process.exitCode = 2;
} else {
  void run(role).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

async function run(selectedRole: Role): Promise<void> {
  process.umask(0o077);
  const wantHost = selectedRole !== "web" && selectedRole !== "relay";
  if(wantHost&&process.env.PI_COFFEE_COLD_ENROLLMENT_PROFILE&&!process.env.PI_COFFEE_MANAGED_PROFILE_FILE)throw new Error('Cold enrollment requires a managed source profile');
  if(wantHost&&process.env.PI_COFFEE_ORDINARY_SOURCE_PROFILE&&process.env.PI_COFFEE_MANAGED_PROFILE_FILE)throw new Error('Select one backup source profile');
  const captureLimits=wantHost&&(process.env.PI_COFFEE_BACKUP_ROOT||process.env.PI_COFFEE_MANAGED_PROFILE_FILE||process.env.PI_COFFEE_ORDINARY_SOURCE_PROFILE)?{maxBytes:positiveBackupBound('PI_COFFEE_BACKUP_MAX_BYTES',1024*1024*1024),maxFiles:positiveBackupBound('PI_COFFEE_BACKUP_MAX_FILES',100000),captureTimeoutMs:positiveBackupBound('PI_COFFEE_BACKUP_CAPTURE_TIMEOUT_MS',30000,1800000)}:undefined;
  const managedConfig=wantHost&&process.env.PI_COFFEE_MANAGED_PROFILE_FILE?await loadManagedSourceConfig(process.env.PI_COFFEE_MANAGED_PROFILE_FILE):undefined;
  const managedAuthority=managedConfig?new ManagedSourceAuthority(managedConfig):undefined,legacyPolicy=new ManagedLaunchPolicy();
  const backupRoot=wantHost?(managedConfig?join(managedConfig.sourceParent,'backup'):process.env.PI_COFFEE_BACKUP_ROOT?.trim()):undefined;
  const brokerConfig=wantHost&&process.env.PI_COFFEE_BACKUP_BROKER_CLIENT?await readBackupRepositoryClientConfig(process.env.PI_COFFEE_BACKUP_BROKER_CLIENT):undefined;
  const ordinaryProfile=wantHost&&process.env.PI_COFFEE_ORDINARY_SOURCE_PROFILE?await loadOrdinaryBackupProfile(process.env.PI_COFFEE_ORDINARY_SOURCE_PROFILE):undefined;
  if(ordinaryProfile&&(!backupRoot||!brokerConfig))throw new Error('Ordinary backup requires a backup root and independent broker profile');
  const ordinary=ordinaryProfile?await OrdinaryBackupComposition.open(ordinaryProfile,backupRoot!):undefined;
  if(managedConfig&&!brokerConfig)throw new Error('Managed backup requires independent key service configuration');
  // The Relay is the only process that may hold upstream credentials. `all`
  // starts it when either the LLM key or the Serper key is configured; the
  // generic LLM routes remain unavailable when only search is enabled.
  const upstreamKey = process.env.PI_COFFEE_UPSTREAM_KEY ?? "";
  const serperKey = process.env.PI_COFFEE_SERPER_KEY ?? "";
  const wantRelay = selectedRole === "relay" || (selectedRole === "all" && (upstreamKey.length > 0 || serperKey.length > 0));
  const relay = !wantRelay ? undefined : new RelayServer({
    host: envString("PI_COFFEE_RELAY_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_RELAY_PORT", 8789),
    upstreamBaseUrl: envString("PI_COFFEE_UPSTREAM_URL", "https://b.awangsawangs.xyz/v1"),
    upstreamKey,
    serperApiKey: serperKey,
    serperEndpoint: process.env.PI_COFFEE_SERPER_ENDPOINT,
    clientTokens: envList("PI_COFFEE_RELAY_TOKENS"),
    upstreamHeadersTimeoutMs: envNumber("PI_COFFEE_RELAY_TIMEOUT_MS", 60_000),
    maxRequestBytes: envNumber("PI_COFFEE_RELAY_MAX_REQUEST_BYTES", 32 * 1024 * 1024),
    onRecord: (record) => {
      if (process.env.PI_COFFEE_RELAY_LOG === "0") return;
      console.log(JSON.stringify({ relay: record }));
    },
  });
  if (relay) await relay.start();

  const workdir = managedConfig?join(managedConfig.sourceParent,'scopes',LEGACY_BACKUP_SCOPE,'work'):process.env.PI_COFFEE_WORKDIR ?? process.cwd();
  let runtimeTemp:Awaited<ReturnType<typeof createRuntimeTemp>>|undefined;
  if(wantHost){
    const tempRoot=process.env.PI_COFFEE_TMP_ROOT || join(homedir(),'.cache','pi-coffee','runtime-tmp');
    runtimeTemp=await createRuntimeTemp(tempRoot,process.env.PI_COFFEE_TMP_STORAGE);
    // Only disposable native scratch inherits this directory.
    process.env.TMPDIR=process.env.TMP=process.env.TEMP=runtimeTemp.path;
  }
  // Optional HTTPS route (internal CA). 0.1 runs plain HTTP; when a
  // certificate is given, both browser-facing surfaces must use one, because a
  // browser on an https page refuses plain-http transfers as mixed content.
  const webTls = loadTls("PI_COFFEE_WEB_TLS_CERT", "PI_COFFEE_WEB_TLS_KEY");
  const transferTls = loadTls("PI_COFFEE_TRANSFER_TLS_CERT", "PI_COFFEE_TRANSFER_TLS_KEY");
  if (selectedRole === "all" && (webTls === undefined) !== (transferTls === undefined)) {
    throw new Error("Set TLS for both the Web Server and the transfer port, or for neither (browsers block mixed content)");
  }
  // File transfer (ADR-0009): the Host speaks LocalSend v2 on the User VM's LAN
  // interface so browsers move files without touching the Web Server.
  let host: HostServer | undefined;
  const transferBind = envString("PI_COFFEE_TRANSFER_BIND", "0.0.0.0");
  const transfer = !wantHost || managedConfig || transferBind === "off" ? undefined : new TransferServer({
    host: transferBind,
    port: envNumber("PI_COFFEE_TRANSFER_PORT", 53317),
    workdir,
    advertiseHost: process.env.PI_COFFEE_TRANSFER_ADVERTISE,
    alias: envString("PI_COFFEE_TRANSFER_ALIAS", "PI Coffee"),
    maxFileBytes: envNumber("PI_COFFEE_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES),
    maxBatchBytes: envNumber("PI_COFFEE_MAX_BATCH_BYTES", DEFAULT_MAX_BATCH_BYTES),
    onEvent: (scope, event) => host?.announce(scope, event),
    ...(transferTls === undefined ? {} : { tls: transferTls }),
  });
  if (transfer) await transfer.start();

  // One shared User VM, one model login, one Host (ADR-0010). Each Gitea user
  // the Web Server forwards gets a private cwd and session store under the
  // shared roots; the agent dir (model account, models.json) stays common.
  const piRuntime = wantHost ? await HostPiRuntime.load() : undefined;
  const piOptions = {
    agentDir: managedConfig?join(managedConfig.sourceParent,'native-config'):process.env.PI_COFFEE_AGENT_DIR,
    provider: managedConfig?.providerTransports?.pi?.provider??process.env.PI_COFFEE_PROVIDER,
    providerOnly:managedConfig?.providerTransports?.pi?.provider,
    model: process.env.PI_COFFEE_MODEL,
    allowedModels: managedConfig?.providerTransports?.pi?managedConfig.providerTransports.pi.models.map(model=>managedConfig.providerTransports!.pi!.provider+'/'+model):process.env.PI_COFFEE_PI_ALLOWED_MODELS === undefined ? undefined : envList("PI_COFFEE_PI_ALLOWED_MODELS", ","),
    runtime: piRuntime,
    args: ["--no-extensions"], // Only the reviewed package roots execute in Host sessions.
  };
  const sessionRoot = managedConfig?join(managedConfig.sourceParent,'scopes',LEGACY_BACKUP_SCOPE,'native'):process.env.PI_COFFEE_SESSION_DIR?.trim();
  // Which agent runs behind the seam (ADR-0011): the original Pi (default) or
  // Codex CLI's app-server. Both are logged in once, in the VM, by its owner.
  const agent = envString("PI_COFFEE_AGENT", "pi").toLowerCase();
  if (agent !== "pi" && agent !== "codex") throw new Error("PI_COFFEE_AGENT must be pi or codex");
  const codexSandbox = envString("PI_COFFEE_CODEX_SANDBOX", "danger-full-access");
  const codexApproval = envString("PI_COFFEE_CODEX_APPROVAL", "never");
  if (!["read-only", "workspace-write", "danger-full-access"].includes(codexSandbox)) throw new Error("PI_COFFEE_CODEX_SANDBOX must be read-only, workspace-write or danger-full-access");
  if (!["never", "on-request", "untrusted"].includes(codexApproval)) throw new Error("PI_COFFEE_CODEX_APPROVAL must be never, on-request or untrusted");
  const idleTimeoutMs = envNumber("PI_COFFEE_IDLE_TIMEOUT_MS", 10 * 60 * 1000);
  const taskAccounts=JSON.parse(process.env.PI_COFFEE_TASK_USER_MAP ?? '{}');
  if(!taskAccounts || typeof taskAccounts!=='object' || Array.isArray(taskAccounts))throw new Error('Invalid task storage user map');
  if(managedConfig)await mkdir(join(managedConfig.sourceParent,'authority'),{recursive:true,mode:0o700});
  const recoveryAdapters=new Map<string,NativeRecoveryAdapter&NativeRestoreAdapter>();
  const restoreScopes=new Map<string,Workspaces>();
  const managedGroupId=managedConfig?'managed-'+createHash('sha256').update(join(managedConfig.sourceParent,'authority','group.lock')).digest('hex'):undefined;
  const publicationGate=ordinary?.publicationGate??(managedConfig&&backupRoot?new ManagedPublicationGate({path:join(managedConfig.sourceParent,'authority','publication.json'),groupId:managedGroupId!,restoreRoot:join(backupRoot,'restore-runtime')}):undefined);
  const sourceMembers=async():Promise<GroupedRecoveryMember[]>=>{const tasks:GroupedRecoveryMember[]=[];for(const [scope,store]of managedStores)for(const task of (await store.list()).conversations)if(!task.workspaceRemoved&&!task.cleanupStarted&&['pi','codex'].includes(task.engine??'pi'))tasks.push({scope,taskId:task.id,engine:task.engine??'pi'});return tasks;};
  const resolveRecovery=async(scope:string,id:string)=>{const adapter=recoveryAdapters.get(scope);if(!adapter)throw new BackupError('writers_unknown','Native source custody unavailable');return adapter.resolve(scope,id);};
  const backupCoordinator=backupRoot?(ordinary?ordinary.createCoordinator(join(backupRoot,'checkpoints'),captureLimits):new BackupCoordinator({root:join(backupRoot,'checkpoints'),...captureLimits,adapter:{version:'pi-coffee-native-recovery-v1',resolve:async(scope,id)=>managedConfig&&managedFence?new GroupedRecoveryAdapter({groupId:managedGroupId!,fence:managedFence!,inventory:sourceMembers,resolve:resolveRecovery,maxBytes:captureLimits?.maxBytes,maxFiles:captureLimits?.maxFiles}).resolve(scope,id):resolveRecovery(scope,id)}})):undefined;
  // Ordinary HTTP/WS requests always obtain a fresh actor+scope facade. The
  // independent scheduler CLI owns its privileged worker profile separately.
  const scheduleForActor=brokerConfig&&backupRoot&&backupCoordinator?(actor:string|undefined,dataScope:string)=>actor?new BackupJobRunner({root:join(backupRoot,'schedule'),coordinator:backupCoordinator,repository:new BackupRepositoryClient({...brokerConfig,actor,dataScope})}):undefined:undefined;
  const scheduleConnection=backupRoot?trustedBackupInventoryConnection():undefined;
  const authorizeRecovery=async(actor:string,scope:string,manage:boolean)=>{const managed=scope===LEGACY_BACKUP_SCOPE||envList('PI_COFFEE_BACKUP_USERS').includes(scope)||scope===actor;return managed&&(actor==='awangs'||!manage&&actor===scope);};
  const restoreScope=async(scope:string):Promise<RestoreScope>=>{if(!restoreScopes.has(scope))await host?.prepareRestoreScope(scope===LEGACY_BACKUP_SCOPE?undefined:scope);const workspaces=restoreScopes.get(scope);if(!workspaces)throw new BackupError('unknown_scope','Restore scope unavailable');return {workspaces,adapter:recoveryAdapters.get(scope),withPublication:async(id,run,operationId,preparation)=>host!.withRestorePublication(scope===LEGACY_BACKUP_SCOPE?undefined:scope,id,async()=>{if(publicationGate)return publicationGate.withApprovedPublication(operationId,run,preparation);await preparation.preflight();await preparation.commitIntent();return run();},operationId,{deferMetadata:true}),beforePublication:context=>host!.prepareRecoveryPublication(scope===LEGACY_BACKUP_SCOPE?undefined:scope,context)};};
  const restoreRepository=async(actor:string,scope:string)=>{if(!brokerConfig)throw new BackupError('restore_material_broker_unavailable','An authorized scoped material broker is required');return new BackupRepositoryClient({...brokerConfig,actor,dataScope:scope});};
  const restoreCoordinator=backupRoot?new RestoreCoordinator({root:join(backupRoot,'restore-runtime'),materialSource:context=>restoreRepository(context.actor,context.scope),authorize:authorizeRecovery,scope:restoreScope,
    safetyCheckpoint:async context=>{const repository=await restoreRepository(context.actor,context.scope),hex=createHash('sha256').update('replacement-safety:'+context.operationId+':'+context.revision).digest('hex'),requestId=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20,32);let job=await repository.recoveryJob(requestId,context.scope);if(!job){const store=(await restoreScope(context.scope)).workspaces,task=await store.lookup(context.taskId);if(!task||!backupCoordinator)throw new BackupError('replacement_safety_unavailable','Current source unavailable');const capture=await backupCoordinator.capture(context.scope,context.taskId,task.engine??'pi');if(capture.state!=='protected'||!capture.checkpointId)throw new BackupError('replacement_safety_unavailable','A fresh complete source cut is required');job=await repository.backup([{scope:context.scope,taskId:context.taskId,expectedCheckpointId:capture.checkpointId}],undefined,requestId);}const point=job.points.find(point=>point.scope===context.scope&&point.taskId===context.taskId);if(job.state!=='succeeded'||job.verification!=='repository-read'||!point)throw new BackupError('replacement_safety_invalid','Current source safety point is not verified');return {jobId:job.id,checkpointId:point.checkpointId};}
  }):undefined;
  const accountRecovery=backupRoot&&restoreCoordinator?new AccountRecoveryCoordinator({root:join(backupRoot,'account-restore-runtime'),restore:restoreCoordinator,scope:restoreScope,authorize:authorizeRecovery,materialSource:restoreRepository,pins:restoreRepository}):undefined;
  const sourceCustody=backupRoot&&!ordinary?new BackupSourceCustody(join(backupRoot,'source-ownership')):undefined;
  const custody=ordinary?.custody??(backupRoot?new AdmissionNativeCustody(join(backupRoot,'native-custody','shared-native-group'),legacyPolicy):undefined);
  let managedFence:ManagedWriterFence|undefined;const managedStores=new Map<string,Workspaces>();
  const writerFence=ordinary?.fence??(backupRoot?new LegacyAdmissionFence(legacyPolicy,{writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>{const state=await custody!.state();return {known:state.state==='quiescent',active:state.state==='active',...(state.state!=='quiescent'?{reason:state.reason}:{})};}}):undefined);
  const allocateNew=async(path:string)=>{if(ordinary)await mkdir(path,{recursive:true,mode:0o700});if(sourceCustody&&!await lstat(path).then(()=>true,()=>false)){await mkdir(dirname(path),{recursive:true,mode:0o700});await sourceCustody.allocate(path);}};
  const createScope=(cwd:string,sessionDir:string|undefined,user?:string):Promise<UserScope>=>ordinary?ordinary.fence.runWriter('platform',()=>createScopeAdmitted(cwd,sessionDir,user)):createScopeAdmitted(cwd,sessionDir,user);
  const createScopeAdmitted = async (cwd:string,sessionDir:string|undefined,user?:string):Promise<UserScope> => {
    const scopeId=user??LEGACY_BACKUP_SCOPE,scopeTransports=managedConfig?.scopeProviderTransports?.[user??LEGACY_BACKUP_SCOPE]??managedConfig?.providerTransports,managedLayout=managedConfig?managedScopeLayout(managedConfig.sourceParent,scopeId):undefined,scopeRoot=managedLayout?.scopeRoot;
    if(scopeRoot){cwd=join(scopeRoot,'work');sessionDir=join(scopeRoot,'native');await mkdir(scopeRoot,{recursive:true,mode:0o700});}
    const scopeAgentDir=managedLayout?.agentDir??piOptions.agentDir??(ordinary?getAgentDir():undefined),controlRoot=managedLayout?.controlRoot;if(controlRoot)await mkdir(controlRoot,{recursive:true,mode:0o700});
    await allocateNew(cwd);
    const nativeSessionDir=sessionDir??join(cwd,'.pi-coffee','sessions');
    await allocateNew(nativeSessionDir);
    if(scopeAgentDir)await allocateNew(scopeAgentDir);
    await mkdir(cwd,{recursive:true});
    const workRoot=managedConfig||user ? cwd : process.env.PI_COFFEE_WORK_ROOT ?? cwd;
    const giteaAccount=await giteaAccountForScope(process.env.PI_COFFEE_GITEA_ACCOUNTS_FILE,user,process.env.PI_COFFEE_GITEA_TOKEN&&process.env.PI_COFFEE_GITEA_OWNER?{login:process.env.PI_COFFEE_GITEA_OWNER,token:process.env.PI_COFFEE_GITEA_TOKEN}:undefined);
    const gitea=process.env.PI_COFFEE_GITEA_URL&&giteaAccount?{url:process.env.PI_COFFEE_GITEA_URL,token:giteaAccount.token,owner:giteaAccount.login,userId:giteaAccount.userId}:undefined;
    const forge=gitea?new GiteaClient({baseUrl:gitea.url,...gitea}):undefined;
    const githubAccounts=new GitHubAccounts(join(controlRoot??sessionDir??join(cwd,'.pi-coffee'),'github-accounts'),{...(process.env.PI_COFFEE_GITHUB_REFRESH_URL?{renew:githubRenewalClient(process.env.PI_COFFEE_GITHUB_REFRESH_URL,process.env.PI_COFFEE_HOST_TOKEN??'',user)}:{}),...(gitea?{gitea}:{}),...(giteaAccount?.gitEmail?{gitIdentity:{name:giteaAccount.gitName??giteaAccount.login,email:giteaAccount.gitEmail}}:{})});
    const deniedGitHub=await githubAccounts.environment(undefined);
    const accountProjects=scopeRoot?join(scopeRoot,'tasks'):taskRootForScope(process.env.PI_COFFEE_TASK_ROOT,process.env.PI_COFFEE_TASK_DEFAULT_USER,user,taskAccounts);
    const accountGuidance=accountScopeInstruction(giteaAccount?.login??user??'VM owner',accountProjects?dirname(accountProjects):cwd);
    const projectSource=managedConfig||user?join(workRoot,'projects'):process.env.PI_COFFEE_PROJECT_ROOT??join(workRoot,'projects');
    const chatSource=managedConfig||user?join(workRoot,'chats'):process.env.PI_COFFEE_CHAT_ROOT??join(workRoot,'chats');
    for(const path of [projectSource,chatSource,...(accountProjects?[accountProjects]:[])])await allocateNew(path);
    const scopeCustody=managedConfig&&scopeRoot?new ManagedNativeCustody(join(managedConfig.sourceParent,'authority','custody'),{sourceParent:managedConfig.sourceParent,lock:join(managedConfig.sourceParent,'authority','group.lock'),sources:[{path:scopeRoot,destination:scopeRoot}],runtimeRoots:managedConfig.runtimeRoots,providerTransports:scopeTransports,requireProviderTransport:true,environment:{HOME:join(scopeRoot,'home'),PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'C.UTF-8',PI_CODING_AGENT_DIR:scopeAgentDir!,CODEX_HOME:join(scopeRoot,'codex'),CODEX_SQLITE_HOME:join(scopeRoot,'codex')},cwd},{publication:publicationGate}):undefined;
    if(scopeCustody){await mkdir(join(scopeRoot!,'home'),{mode:0o700,recursive:true});await mkdir(join(scopeRoot!,'codex'),{mode:0o700,recursive:true});managedAuthority!.register(scopeId,scopeCustody);managedFence??=new ManagedWriterFence({lock:scopeCustody.profile.lock,custody:scopeCustody,publicationGate});}
    const scopeFence=managedFence??writerFence,nativeCustody=scopeCustody??custody;
    // Provenance and descendant custody do not fence writers launched through existing
    // daemons or unrestricted same-UID tools. No production enforcement provider is qualified.
    const sourceProof=async()=>{if(ordinary){try{if(workspaces.backupGitCustody!==ordinary.custody)return {known:false,reason:'Host Git writer custody is unbound'};const paths=[cwd,nativeSessionDir,scopeAgentDir!,projectSource,chatSource,...accountProjects?[accountProjects]:[]].map(path=>resolve(path));if(codexCommand){const roots=await codexStore<{nativeHome:string;sqliteHome:string}>({operation:'roots',home:resolve(codexOptions.codexHome??process.env.CODEX_HOME??join(homedir(),'.codex')),environmentSqliteHome:codexOptions.env.CODEX_SQLITE_HOME??process.env.CODEX_SQLITE_HOME});paths.push(roots.nativeHome,roots.sqliteHome);}return ordinary.sourceProof(paths);}catch{return {known:false,reason:'Ordinary source paths are not qualified'};}}if(managedAuthority)return managedAuthority.sourceProof(scopeId);if(backupRoot&&await lstat(join(backupRoot,'unmanaged-writer-seen')).then(()=>true,()=>false))return {known:false,reason:'An unmanaged native writer requires source requalification'};if(!sourceCustody||!scopeAgentDir)return {known:false,reason:'Explicit private native configuration custody is required'};for(const path of [cwd,nativeSessionDir,scopeAgentDir,projectSource,chatSource,...(accountProjects?[accountProjects]:[])])if((await sourceCustody.owns(path)).state!=='owned')return {known:false,reason:'Legacy or unmanaged native source has no ownership receipt'};return {known:false,reason:'writer-enforcement-unqualified'};};
    const workspaces=new Workspaces(projectSource,{...(ordinary?{gitCommandCustody:ordinary.custody}:{}),managedGitCustody:scopeCustody,deferStartupReconciliation:()=>publicationGate?.hasPending()??false,taskRoot:accountProjects,chatRoot:chatSource,ownerId:user ?? process.env.PI_COFFEE_VM_ID,forge,githubAccounts});
    if(scopeFence)workspaces.setBackupWriterFence(scopeFence);
    await workspaces.list();restoreScopes.set(scopeId,workspaces);if(managedConfig||ordinary)managedStores.set(scopeId,workspaces);

    const codexCommand=process.env.PI_COFFEE_CODEX_COMMAND ?? process.env.PI_COFFEE_CODEX_BIN ?? (agent==="codex" ? "codex" : undefined);
    const bookkeeping=controlRoot??sessionDir ?? join(cwd,".pi-coffee");
    const runners=new RunnerManager(controlRoot?join(controlRoot,"runners"):sessionDir ? join(sessionDir,"runners") : join(homedir(),".local/share/pi-coffee/runners",...(user ? ["users",user] : ["default"])));
    const sshme=new RunnerManager(join(runners.root,'sshme'),'sshme');
    const instructions=async(id?:string)=>{const task=id?await workspaces.lookup(id):undefined;if(task?.workspaceKind==='chat')return undefined;return [hostSessionInstructions(accountGuidance),task?await workspaces.forkInstructionForCwd(task.cwd):undefined].filter(Boolean).join('\n');};
    const codexOptions={nativeCustody,protectedProvider:scopeTransports?.codex?.provider,allowedModels:scopeTransports?.codex?.models,env:{...deniedGitHub,...(scopeRoot?{CODEX_SQLITE_HOME:join(scopeRoot,'codex')}:{})},instructions,cliPath:codexCommand,codexHome:scopeRoot?join(scopeRoot,'codex'):process.env.PI_COFFEE_CODEX_HOME,model:process.env.PI_COFFEE_CODEX_MODEL ?? (agent==="codex" ? process.env.PI_COFFEE_MODEL : undefined),reasoningEffort:process.env.PI_COFFEE_CODEX_EFFORT,sandbox:codexSandbox as "read-only"|"workspace-write"|"danger-full-access",approvalPolicy:codexApproval as "never"|"on-request"|"untrusted",idleTimeoutMs,args:envList("PI_COFFEE_CODEX_ARGS",":")};
    const codexVersion=codexCommand?(ordinary?await ordinary.codexVersion(codexCommand,{cwd,env:{...codexOptions.env,...(codexOptions.codexHome?{CODEX_HOME:codexOptions.codexHome}:{})}}):await codexRecoveryVersion(codexCommand)):'unknown';
    if(ordinary)ordinary.registerScope({scope:scopeId,workspaces,pi:{sessionDir:resolve(nativeSessionDir),agentDir:resolve(scopeAgentDir!)},...(codexCommand?{codex:{home:resolve(codexOptions.codexHome??process.env.CODEX_HOME??join(homedir(),'.codex')),environmentSqliteHome:codexOptions.env.CODEX_SQLITE_HOME??process.env.CODEX_SQLITE_HOME,version:codexVersion,nativeArgs:codexOptions.args}}:{})});
    if(scopeFence){const piRecovery=new PiNativeRecoveryAdapter({scope:scopeId,workspaces,sessionDir:nativeSessionDir,agentDir:scopeAgentDir,fence:scopeFence,sourceCustody:sourceProof}),codexRecovery=new CodexNativeRecoveryAdapter({scope:scopeId,workspaces,codexHome:codexOptions.codexHome??process.env.CODEX_HOME??join(homedir(),'.codex'),environmentSqliteHome:codexOptions.env.CODEX_SQLITE_HOME??process.env.CODEX_SQLITE_HOME,cliVersion:codexVersion,nativeArgs:codexOptions.args,fence:scopeFence,sourceCustody:sourceProof});recoveryAdapters.set(scopeId,new CombinedNativeRecoveryAdapter({workspaces,pi:piRecovery,codex:codexRecovery,fence:scopeFence}));}
    const legacyCodex=codexCommand ? new CodexSessionFactory({...codexOptions,cwd,mappingFile:join(bookkeeping,"codex-threads.json")}) : undefined;
    const factory=new NativeAgentFactory({workspaces,instructions,writerFence:scopeFence,commandCustody:nativeCustody,managedCustody:scopeCustody,beforeNativeExecution:async engine=>{if(managedAuthority){if(engine!=='pi'&&engine!=='codex')throw new Error('This engine is unavailable in the protected execution profile');if(!scopeTransports?.[engine])throw new Error('This engine has no protected provider transport');if(!(await managedAuthority.sourceProof(scopeId)).known)throw new Error('Managed source enrollment is not qualified');}else if(ordinary){if(engine!=='pi'&&engine!=='codex')await ordinary.authority.invalidateCoverage('unregistered-producer');}else{legacyPolicy.assertLegacyAllowed();if(engine!=='pi'&&engine!=='codex')legacyPolicy.markUnknown();}},beforeUnmanagedNative:backupRoot?async()=>{if(ordinary)await ordinary.authority.invalidateCoverage('unregistered-producer');legacyPolicy.assertLegacyAllowed();legacyPolicy.markUnknown();await mkdir(backupRoot,{recursive:true,mode:0o700});try{await writeFile(join(backupRoot,'unmanaged-writer-seen'),'unmanaged-native-v1\n',{flag:'wx',mode:0o600,flush:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}:undefined,
      pi:new RpcPiSessionFactory({...piOptions,agentDir:scopeAgentDir,...(managedConfig?{provider:scopeTransports?.pi?.provider,providerOnly:scopeTransports?.pi?.provider,allowedModels:scopeTransports?.pi?.models.map(model=>scopeTransports.pi!.provider+'/'+model)}:{}),instructions,cwd,writerFence:scopeFence,nativeCustody,sessionDir:nativeSessionDir,runtimeIdForSession:id=>taskNamespace(user,id),env:{...deniedGitHub,PATH:deniedGitHub.PATH+':'+piRuntime!.path(),COFFEE_MANAGED_PATH:deniedGitHub.PATH+':'+piRuntime!.path()},
        cwdForSession:async(id,existing)=>{if(await workspaces.lookup(id))return workspaces.file(id,"");if(existing)return cwd;throw new Error("Create a Chat or Work task first");},
        extensionsForSession:async id=>(await host?.mishuRuntime(user,id))?.extensions??[],
        envForSession:async id=>{const task=await workspaces.lookup(id),env=task?await workspaces.runtimeEnvironment(id):deniedGitHub;return {...env,...(task?.workspaceKind==='project'?{PI_COFFEE_ACCOUNT_GUIDANCE:accountGuidance}:{}),...(await host?.mishuRuntime(user,id))?.env,PATH:env.PATH+':'+piRuntime!.path(),COFFEE_MANAGED_PATH:env.PATH+':'+piRuntime!.path()};},
      }),
      ...(codexCommand ? {codex:{command:codexCommand,...(process.env.PI_COFFEE_CODEX_HOME ? {env:{CODEX_HOME:process.env.PI_COFFEE_CODEX_HOME}} : {})},
        codexSessionOptions:(id:string,taskCwd:string,_onBound:(nativeId:string)=>Promise<void>,_environment?:()=>Promise<Record<string,string>>,preparation?:boolean)=>({...codexOptions,mishuContext:preparation?undefined:async()=>{const task=await workspaces.lookupByCwd(taskCwd);return task?host?.mishuSourceContext(user,task.id):undefined;},allowEmptyRecovery:async()=>{const task=await workspaces.lookupByCwd(taskCwd);return task?.workspaceKind==='chat'&&task.engine==='codex'&&task.nativeContextEmpty===true;},instructions:async()=>{const task=await workspaces.lookupByCwd(taskCwd);return instructions(task?.id);},mappingFile:join(bookkeeping,"codex",id+".json")}),
        legacyCodex,
      } : {}),
      ...(process.env.PI_COFFEE_CLAUDE_COMMAND ? {claude:{command:process.env.PI_COFFEE_CLAUDE_COMMAND,env:deniedGitHub}} : {}),
      ...(process.env.PI_COFFEE_GROK_COMMAND ? {grok:{command:process.env.PI_COFFEE_GROK_COMMAND,env:deniedGitHub}} : {}),
      ...(process.env.PI_COFFEE_CURSOR_COMMAND ? {cursor:{command:process.env.PI_COFFEE_CURSOR_COMMAND,env:deniedGitHub}} : {}),
    });
    return {workdir:cwd,workspaces,factory,runners,sshme,githubAccounts,skills:{root:process.env.PI_COFFEE_SKILL_ROOT,piAgentDir:managedConfig?scopeAgentDir:process.env.PI_COFFEE_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR,claudeDir:process.env.CLAUDE_CONFIG_DIR,bundledPiSkills:piRuntime!.skills(),...(gitea?{gitea}:{})}};
  };
  const defaultScope=wantHost ? await createScope(workdir,sessionRoot) : undefined;
  const scopeForUser = (user:string):Promise<UserScope> => createScope(resolve(workdir,user),sessionRoot ? join(sessionRoot,user) : undefined,user);
  host = !wantHost ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    runtimeStatus: piRuntime?.status,
    ...(backupCoordinator?{backup:{coordinator:backupCoordinator,restore:restoreCoordinator,accountRecovery,...(scheduleForActor?{scheduleForActor,scheduleConnection}:{}),...(brokerConfig?{repositoryForActor:(actor:string|undefined,dataScope:string)=>actor?new BackupRepositoryClient({...brokerConfig,actor,dataScope}):undefined,configureRepositoryForActor:async(actor:string|undefined,dataScope:string)=>{if(!actor)throw new BackupError('forbidden','Authenticated administrator required');await new BackupRepositoryClient({...brokerConfig,actor,dataScope}).configure();}}:{binary:process.env.PI_COFFEE_RESTIC_BINARY,activationUnavailable:'Runtime secret is not isolated from unrestricted model processes'}),administrator:'awangs',scopes:envList("PI_COFFEE_BACKUP_USERS")}}:{}),
    releaseDir:process.env.PI_COFFEE_RELEASE_DIR??process.cwd(),
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    idleTimeoutMs,
    requireUser: envFlag("PI_COFFEE_REQUIRE_USER"),
    transfer,
    ...defaultScope!,
    sharedSkillOwner:process.env.PI_COFFEE_SKILL_OWNER,
    sharedSkillManagers:envList("PI_COFFEE_SKILL_MANAGERS"),
    scopeForUser,
    savedMishuScopes:()=>savedMishuScopes(workdir,defaultScope!.workspaces!.root),
  });
  if(managedAuthority){for(const scope of [...new Set([...envList('PI_COFFEE_BACKUP_USERS'),...Object.keys(managedConfig?.scopeProviderTransports??{})])])if(scope!==LEGACY_BACKUP_SCOPE)await host!.prepareRestoreScope(scope);await managedAuthority.activate();await managedAuthority.startServer(backupCoordinator!);}
  if(ordinary){for(const scope of envList('PI_COFFEE_BACKUP_USERS'))if(scope!==LEGACY_BACKUP_SCOPE)await host!.prepareRestoreScope(scope);await ordinary.ensureQualified();await ordinary.startSource(backupCoordinator!,captureLimits?.maxBytes);}
  const coldEnrollment=managedAuthority&&accountRecovery&&brokerConfig&&process.env.PI_COFFEE_COLD_ENROLLMENT_PROFILE?await startColdEnrollmentControl({socket:process.env.PI_COFFEE_COLD_ENROLLMENT_SOCKET??join(managedConfig!.sourceParent,'authority','cold-enrollment.sock'),profile:process.env.PI_COFFEE_COLD_ENROLLMENT_PROFILE,accounts:accountRecovery,authority:managedAuthority,broker:brokerConfig}):undefined;
  const automaticCheckpoints=(ordinary||managedAuthority&&managedFence)&&backupCoordinator?new ManagedCheckpointRefresh({coordinator:backupCoordinator,revision:()=>ordinary?.physical.changeRevision??managedFence!.changeRevision,qualified:async()=>{await ordinary?.ensureQualified();return [...managedStores.keys()].length>0&&(ordinary?(await ordinary.authority.qualification()).state==='qualified':(await managedAuthority!.sourceProof([...managedStores.keys()][0])).known);},tasks:async()=>{const tasks=[];for(const [scope,store]of managedStores){for(const task of (await store.list()).conversations){if(!task.workspaceRemoved&&!task.cleanupStarted)tasks.push({scope,taskId:task.id,engine:task.engine??'pi' as const});}}return tasks;}}):undefined;
  const admissionServer=wantHost&&!managedAuthority&&!ordinary&&process.env.PI_COFFEE_NATIVE_ADMISSION_SOCKET&&custody?await startManagedAdmissionControl({socket:process.env.PI_COFFEE_NATIVE_ADMISSION_SOCKET,allowedUid:envNumber('PI_COFFEE_NATIVE_ADMISSION_UID',-1),policy:legacyPolicy,custody,writerFence,coldCutRoot:process.env.PI_COFFEE_LEGACY_COLD_CUT_ROOT}):undefined;
  if (host) await host.start();
  automaticCheckpoints?.start();

  // Gitea OAuth is on as soon as the app credentials are configured. Without
  // them the shell is open (local smoke); PI_COFFEE_DEFAULT_USER can still
  // exercise the per-user layout on the Host.
  const giteaUrl = process.env.PI_COFFEE_GITEA_URL?.trim();
  const giteaClientId = process.env.PI_COFFEE_GITEA_CLIENT_ID?.trim();
  const giteaClientSecret = process.env.PI_COFFEE_GITEA_CLIENT_SECRET?.trim();
  const wantWeb = selectedRole !== "host" && selectedRole !== "relay";
  let auth: GiteaAuth | undefined;
  const routeFile=process.env.PI_COFFEE_ROUTES_FILE;
  if (wantWeb && !routeFile && (giteaUrl || giteaClientId || giteaClientSecret)) {
    if (!giteaUrl || !giteaClientId || !giteaClientSecret) {
      throw new Error("Set PI_COFFEE_GITEA_URL, PI_COFFEE_GITEA_CLIENT_ID and PI_COFFEE_GITEA_CLIENT_SECRET together");
    }
    const allowedUsers = parseAllowedUsers(process.env.PI_COFFEE_ALLOWED_USERS);
    if (allowedUsers.length === 0) throw new Error("PI_COFFEE_ALLOWED_USERS must list at least one Gitea login when Gitea login is enabled");
    const cookieSecret = process.env.PI_COFFEE_COOKIE_SECRET?.trim();
    if (!cookieSecret) console.warn("PI_COFFEE_COOKIE_SECRET is not set: everyone must log in again after each Web Server restart");
    // The OAuth redirect URI and the cookie's Secure flag derive from this; it
    // must not come from whatever Host header a client sends.
    const publicUrl = process.env.PI_COFFEE_PUBLIC_URL?.trim();
    if (!publicUrl || !/^https?:\/\//.test(publicUrl)) throw new Error("PI_COFFEE_PUBLIC_URL (http(s)://host[:port] browsers use) is required when Gitea login is enabled");
    auth = new GiteaAuth({
      giteaUrl,
      clientId: giteaClientId,
      clientSecret: giteaClientSecret,
      allowedUsers,
      publicUrl,
      cookieSecret,
    });
  }
  const defaultUser = normalizeUsername(process.env.PI_COFFEE_DEFAULT_USER);
  if (process.env.PI_COFFEE_DEFAULT_USER?.trim() && defaultUser === undefined) {
    throw new Error("PI_COFFEE_DEFAULT_USER must be a plain login name (letters, digits, . - _)");
  }

  let identity: IdentityOptions | undefined;
  if (wantWeb && routeFile) {
    const required = (key: string): string => {
      const value = process.env[key]?.trim();
      if (!value) throw new Error(`${key} is required for multi-user mode`);
      return value;
    };
    identity = {
      sharedHost: process.env.PI_COFFEE_SHARED_HOST === "1",
      giteaUrl: required("PI_COFFEE_GITEA_URL"),
      clientId: required("PI_COFFEE_GITEA_CLIENT_ID"),
      clientSecret: required("PI_COFFEE_GITEA_CLIENT_SECRET"),
      publicUrl: required("PI_COFFEE_PUBLIC_URL"),
      routes: () => parseUserRoutes(readFileSync(routeFile, "utf8")),
    };
  }

  const githubOAuth=wantWeb?githubOAuthOptions():undefined;
  const web = !wantWeb ? undefined : new WebServer({
    restart:restartOptions(),
    releaseDir:process.env.PI_COFFEE_RELEASE_DIR??process.cwd(),
    githubOAuth,
    host: envString("PI_COFFEE_WEB_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_WEB_PORT", 3000),
    hostUrl: process.env.PI_COFFEE_HOST_URL ?? `ws://127.0.0.1:${host?.address().port ?? envNumber("PI_COFFEE_HOST_PORT", 8788)}/host`,
    hostToken: process.env.PI_COFFEE_HOST_TOKEN,
    ...(webTls === undefined ? {} : { tls: webTls }),
    ...(identity === undefined ? {} : { identity }),
    allowUnauthenticated:process.env.PI_COFFEE_ALLOW_UNAUTHENTICATED==="1",
    ...(auth === undefined ? {} : { auth }),
    ...(auth !== undefined || defaultUser === undefined ? {} : { defaultUser }),
  });
  if (web) await web.start();

  const shutdown = async () => {
    if(coldEnrollment)await new Promise<void>(done=>coldEnrollment.close(()=>done()));
    await web?.close();
    await host?.close();
    await automaticCheckpoints?.close();await managedAuthority?.close();await ordinary?.close();
    if(admissionServer)await new Promise<void>(done=>admissionServer.close(()=>done()));
    await transfer?.close();
    await relay?.close();
    await runtimeTemp?.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  const addresses = [
    relay ? `Relay http://${relay.address().host}:${relay.address().port}/v1` : undefined,
    host ? `Host ws://${host.address().host}:${host.address().port}/host (agent: ${agent})` : undefined,
    transfer ? `Transfer ${transfer.publicUrl()}/api/localsend/v2 (LocalSend v2, inbox ${transfer.inboxFor("<session>").split("\\").join("/")})` : undefined,
    web ? `Web ${web.scheme}://${web.address().host}:${web.address().port}/${auth ? " (Gitea login on)" : defaultUser ? ` (user ${defaultUser})` : ""}` : undefined,
  ].filter((address): address is string => address !== undefined);
  for (const address of addresses) console.log(address);
}

function envString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/** Reads a PEM certificate/key pair named by two env vars; undefined when neither is set. */
function loadTls(certVar: string, keyVar: string): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env[certVar]?.trim();
  const keyPath = process.env[keyVar]?.trim();
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) throw new Error(`${certVar} and ${keyVar} must be set together`);
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

function envFlag(name: string): boolean {
  return ["1", "on", "true", "yes"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function envList(name: string, separator = ","): string[] {
  return (process.env[name] ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Operator-only resource limits: invalid settings fail before listeners open. */
function positiveBackupBound(name:string,fallback:number,max=Number.MAX_SAFE_INTEGER){const raw=process.env[name];if(raw===undefined)return fallback;if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)throw new Error('Invalid '+name);return Number(raw);}
function trustedBackupInventoryConnection():BackupInventoryConnection|undefined{
  const value=process.env.PI_COFFEE_BACKUP_INVENTORY_URL,tokenFile=process.env.PI_COFFEE_BACKUP_INVENTORY_TOKEN_FILE;
  if(value===undefined&&tokenFile===undefined)return undefined;
  if(!value||!tokenFile||resolve(tokenFile)!==tokenFile)throw new Error('Set PI_COFFEE_BACKUP_INVENTORY_URL and an absolute PI_COFFEE_BACKUP_INVENTORY_TOKEN_FILE together');
  const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Invalid PI_COFFEE_BACKUP_INVENTORY_URL');
  return {url:url.origin,tokenFile,actor:'awangs'};
}
