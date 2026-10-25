import {ManagedCheckpointRefresh} from './host/managed-checkpoint-refresh.js';
import {ManagedNativeCustody} from './host/managed-native.js';
import {ManagedWriterFence} from './host/managed-writer-fence.js';
import {ManagedLaunchPolicy} from './host/managed-launch-policy.js';
import {ManagedSourceAuthority,loadManagedSourceConfig,startManagedAdmissionControl} from './host/managed-source-authority.js';
import {BackupRepositoryClient,readBackupRepositoryClientConfig} from './host/backup-repository-client.js';
import {RestoreCoordinator,type NativeRestoreAdapter} from './host/restore.js';
import {BackupRepository} from './host/backup-repository.js';
import {BackupCoordinator,BackupError,WriterAdmissionFence,LEGACY_BACKUP_SCOPE,type NativeRecoveryAdapter} from './host/backup.js';
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

  const wantHost = selectedRole !== "web" && selectedRole !== "relay";
  const managedConfig=wantHost&&process.env.PI_COFFEE_MANAGED_PROFILE_FILE?await loadManagedSourceConfig(process.env.PI_COFFEE_MANAGED_PROFILE_FILE):undefined;
  const managedAuthority=managedConfig?new ManagedSourceAuthority(managedConfig):undefined,legacyPolicy=new ManagedLaunchPolicy();
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
  const transfer = !wantHost || transferBind === "off" ? undefined : new TransferServer({
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
    provider: process.env.PI_COFFEE_PROVIDER,
    model: process.env.PI_COFFEE_MODEL,
    allowedModels: process.env.PI_COFFEE_PI_ALLOWED_MODELS === undefined ? undefined : envList("PI_COFFEE_PI_ALLOWED_MODELS", ","),
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
  const backupRoot=wantHost?(managedConfig?join(managedConfig.sourceParent,'backup'):process.env.PI_COFFEE_BACKUP_ROOT?.trim()):undefined;
  const brokerConfig=wantHost&&process.env.PI_COFFEE_BACKUP_BROKER_CLIENT?await readBackupRepositoryClientConfig(process.env.PI_COFFEE_BACKUP_BROKER_CLIENT):undefined;
  if(managedConfig&&!brokerConfig)throw new Error('Managed backup requires independent key service configuration');
  if(managedConfig)await mkdir(join(managedConfig.sourceParent,'authority'),{recursive:true,mode:0o700});
  const recoveryAdapters=new Map<string,NativeRecoveryAdapter&NativeRestoreAdapter>();
  const restoreScopes=new Map<string,Workspaces>();
  const backupCoordinator=backupRoot?new BackupCoordinator({root:join(backupRoot,'checkpoints'),adapter:{version:'pi-coffee-native-recovery-v1',resolve:async(scope,id)=>{const adapter=recoveryAdapters.get(scope);if(!adapter)throw new BackupError('writers_unknown','Native source custody unavailable');return adapter.resolve(scope,id);}}}):undefined;
  const backupRepository=!brokerConfig&&backupRoot&&backupCoordinator?new BackupRepository({root:join(backupRoot,'repository-runtime'),coordinator:backupCoordinator}):undefined;
  const restoreCoordinator=backupRoot?new RestoreCoordinator({root:join(backupRoot,'restore-runtime'),materialSource:async()=>{throw new BackupError('restore_material_broker_unavailable','An authorized scoped material broker is required; Host does not read repository keys');},
    authorize:async(actor,scope,manage)=>{const managed=scope===LEGACY_BACKUP_SCOPE||envList('PI_COFFEE_BACKUP_USERS').includes(scope)||scope===actor;return managed&&(manage?actor==='awangs':actor===scope);},
    scope:async scope=>{if(!restoreScopes.has(scope)){await host?.prepareRestoreScope(scope===LEGACY_BACKUP_SCOPE?undefined:scope);}const workspaces=restoreScopes.get(scope);if(!workspaces)throw new BackupError('unknown_scope','Restore scope unavailable');return {workspaces,adapter:recoveryAdapters.get(scope),withPublication:(id,run,operationId)=>host!.withRestorePublication(scope===LEGACY_BACKUP_SCOPE?undefined:scope,id,run,operationId)};}
  }):undefined;
  const sourceCustody=backupRoot?new BackupSourceCustody(join(backupRoot,'source-ownership')):undefined;
  const custody=backupRoot?new AdmissionNativeCustody(join(backupRoot,'native-custody','shared-native-group'),legacyPolicy):undefined;
  let managedFence:ManagedWriterFence|undefined;const managedStores=new Map<string,Workspaces>();
  const writerFence=backupRoot?new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>{const state=await custody!.state();return {known:state.state==='quiescent',active:state.state==='active',...(state.state!=='quiescent'?{reason:state.reason}:{})};}}):undefined;
  const allocateNew=async(path:string)=>{if(sourceCustody&&!await lstat(path).then(()=>true,()=>false)){await mkdir(dirname(path),{recursive:true,mode:0o700});await sourceCustody.allocate(path);}};
  const createScope = async (cwd:string,sessionDir:string|undefined,user?:string):Promise<UserScope> => {
    const scopeId=user??LEGACY_BACKUP_SCOPE,scopeRoot=managedConfig?join(managedConfig.sourceParent,'scopes',scopeId):undefined;
    if(scopeRoot){cwd=join(scopeRoot,'work');sessionDir=join(scopeRoot,'native');await mkdir(scopeRoot,{recursive:true,mode:0o700});}
    await allocateNew(cwd);
    const nativeSessionDir=sessionDir??join(cwd,'.pi-coffee','sessions');
    await allocateNew(nativeSessionDir);
    if(piOptions.agentDir)await allocateNew(piOptions.agentDir);
    await mkdir(cwd,{recursive:true});
    const workRoot=managedConfig||user ? cwd : process.env.PI_COFFEE_WORK_ROOT ?? cwd;
    const giteaAccount=await giteaAccountForScope(process.env.PI_COFFEE_GITEA_ACCOUNTS_FILE,user,process.env.PI_COFFEE_GITEA_TOKEN&&process.env.PI_COFFEE_GITEA_OWNER?{login:process.env.PI_COFFEE_GITEA_OWNER,token:process.env.PI_COFFEE_GITEA_TOKEN}:undefined);
    const gitea=process.env.PI_COFFEE_GITEA_URL&&giteaAccount?{url:process.env.PI_COFFEE_GITEA_URL,token:giteaAccount.token,owner:giteaAccount.login,userId:giteaAccount.userId}:undefined;
    const forge=gitea?new GiteaClient({baseUrl:gitea.url,...gitea}):undefined;
    const githubAccounts=new GitHubAccounts(join(sessionDir??join(cwd,'.pi-coffee'),'github-accounts'),{...(process.env.PI_COFFEE_GITHUB_REFRESH_URL?{renew:githubRenewalClient(process.env.PI_COFFEE_GITHUB_REFRESH_URL,process.env.PI_COFFEE_HOST_TOKEN??'',user)}:{}),...(gitea?{gitea}:{}),...(giteaAccount?.gitEmail?{gitIdentity:{name:giteaAccount.gitName??giteaAccount.login,email:giteaAccount.gitEmail}}:{})});
    const deniedGitHub=await githubAccounts.environment(undefined);
    const accountProjects=scopeRoot?join(scopeRoot,'tasks'):taskRootForScope(process.env.PI_COFFEE_TASK_ROOT,process.env.PI_COFFEE_TASK_DEFAULT_USER,user,taskAccounts);
    const accountGuidance=accountScopeInstruction(giteaAccount?.login??user??'VM owner',accountProjects?dirname(accountProjects):cwd);
    const projectSource=managedConfig||user?join(workRoot,'projects'):process.env.PI_COFFEE_PROJECT_ROOT??join(workRoot,'projects');
    const chatSource=managedConfig||user?join(workRoot,'chats'):process.env.PI_COFFEE_CHAT_ROOT??join(workRoot,'chats');
    for(const path of [projectSource,chatSource,...(accountProjects?[accountProjects]:[])])await allocateNew(path);
    const scopeCustody=managedConfig&&scopeRoot?new ManagedNativeCustody(join(managedConfig.sourceParent,'authority','custody'),{sourceParent:managedConfig.sourceParent,lock:join(managedConfig.sourceParent,'authority','group.lock'),sources:[{path:scopeRoot,destination:scopeRoot},{path:piOptions.agentDir!,destination:piOptions.agentDir!}],runtimeRoots:managedConfig.runtimeRoots,environment:{HOME:join(scopeRoot,'home'),PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'C.UTF-8',PI_CODING_AGENT_DIR:piOptions.agentDir!,CODEX_HOME:join(scopeRoot,'codex')},cwd}):undefined;
    if(scopeCustody){await mkdir(join(scopeRoot!,'home'),{mode:0o700,recursive:true});await mkdir(join(scopeRoot!,'codex'),{mode:0o700,recursive:true});managedAuthority!.register(scopeId,scopeCustody);managedFence??=new ManagedWriterFence({lock:scopeCustody.profile.lock,custody:scopeCustody});}
    const scopeFence=managedFence??writerFence,nativeCustody=scopeCustody??custody;
    // Provenance and descendant custody do not fence writers launched through existing
    // daemons or unrestricted same-UID tools. No production enforcement provider is qualified.
    const sourceProof=async()=>{if(managedAuthority)return managedAuthority.sourceProof(scopeId);if(backupRoot&&await lstat(join(backupRoot,'unmanaged-writer-seen')).then(()=>true,()=>false))return {known:false,reason:'An unmanaged native writer requires source requalification'};if(!sourceCustody||!piOptions.agentDir)return {known:false,reason:'Explicit private native configuration custody is required'};for(const path of [cwd,nativeSessionDir,piOptions.agentDir,projectSource,chatSource,...(accountProjects?[accountProjects]:[])])if((await sourceCustody.owns(path)).state!=='owned')return {known:false,reason:'Legacy or unmanaged native source has no ownership receipt'};return {known:false,reason:'writer-enforcement-unqualified'};};
    const workspaces=new Workspaces(projectSource,{taskRoot:accountProjects,chatRoot:chatSource,ownerId:user ?? process.env.PI_COFFEE_VM_ID,forge,githubAccounts});
    if(scopeFence)workspaces.setBackupWriterFence(scopeFence);
    await workspaces.list();restoreScopes.set(scopeId,workspaces);if(managedConfig)managedStores.set(scopeId,workspaces);
    if(scopeFence)recoveryAdapters.set(user??LEGACY_BACKUP_SCOPE,new PiNativeRecoveryAdapter({scope:user??LEGACY_BACKUP_SCOPE,workspaces,sessionDir:nativeSessionDir,agentDir:piOptions.agentDir,fence:scopeFence,sourceCustody:sourceProof}));
    const codexCommand=process.env.PI_COFFEE_CODEX_COMMAND ?? process.env.PI_COFFEE_CODEX_BIN ?? (agent==="codex" ? "codex" : undefined);
    const bookkeeping=sessionDir ?? join(cwd,".pi-coffee");
    const runners=new RunnerManager(sessionDir ? join(sessionDir,"runners") : join(homedir(),".local/share/pi-coffee/runners",...(user ? ["users",user] : ["default"])));
    const sshme=new RunnerManager(join(runners.root,'sshme'),'sshme');
    const instructions=async(id?:string)=>{const task=id?await workspaces.lookup(id):undefined;if(task?.workspaceKind==='chat')return undefined;return [hostSessionInstructions(accountGuidance),task?await workspaces.forkInstructionForCwd(task.cwd):undefined].filter(Boolean).join('\n');};
    const codexOptions={nativeCustody,env:deniedGitHub,instructions,cliPath:codexCommand,codexHome:scopeRoot?join(scopeRoot,'codex'):process.env.PI_COFFEE_CODEX_HOME,model:process.env.PI_COFFEE_CODEX_MODEL ?? (agent==="codex" ? process.env.PI_COFFEE_MODEL : undefined),reasoningEffort:process.env.PI_COFFEE_CODEX_EFFORT,sandbox:codexSandbox as "read-only"|"workspace-write"|"danger-full-access",approvalPolicy:codexApproval as "never"|"on-request"|"untrusted",idleTimeoutMs,args:envList("PI_COFFEE_CODEX_ARGS",":")};
    const legacyCodex=codexCommand ? new CodexSessionFactory({...codexOptions,cwd,mappingFile:join(bookkeeping,"codex-threads.json")}) : undefined;
    const factory=new NativeAgentFactory({workspaces,instructions,writerFence:scopeFence,commandCustody:nativeCustody,managedCustody:scopeCustody,beforeNativeExecution:async engine=>{if(managedAuthority){if(engine!=='pi'&&engine!=='codex')throw new Error('This engine is unavailable in the protected execution profile');if(!(await managedAuthority.sourceProof(scopeId)).known)throw new Error('Managed source enrollment is not qualified');}else{legacyPolicy.assertLegacyAllowed();if(engine!=='pi'&&engine!=='codex')legacyPolicy.markUnknown();}},beforeUnmanagedNative:backupRoot?async()=>{legacyPolicy.assertLegacyAllowed();legacyPolicy.markUnknown();await mkdir(backupRoot,{recursive:true,mode:0o700});try{await writeFile(join(backupRoot,'unmanaged-writer-seen'),'unmanaged-native-v1\n',{flag:'wx',mode:0o600,flush:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}:undefined,
      pi:new RpcPiSessionFactory({...piOptions,instructions,cwd,writerFence:scopeFence,nativeCustody,sessionDir:nativeSessionDir,runtimeIdForSession:id=>taskNamespace(user,id),env:{...deniedGitHub,PATH:deniedGitHub.PATH+':'+piRuntime!.path(),COFFEE_MANAGED_PATH:deniedGitHub.PATH+':'+piRuntime!.path()},
        cwdForSession:async(id,existing)=>{if(await workspaces.lookup(id))return workspaces.file(id,"");if(existing)return cwd;throw new Error("Create a Chat or Work task first");},
        extensionsForSession:async id=>(await host?.mishuRuntime(user,id))?.extensions??[],
        envForSession:async id=>{const task=await workspaces.lookup(id),env=task?await workspaces.runtimeEnvironment(id):deniedGitHub;return {...env,...(task?.workspaceKind==='project'?{PI_COFFEE_ACCOUNT_GUIDANCE:accountGuidance}:{}),...(await host?.mishuRuntime(user,id))?.env,PATH:env.PATH+':'+piRuntime!.path(),COFFEE_MANAGED_PATH:env.PATH+':'+piRuntime!.path()};},
      }),
      ...(codexCommand ? {codex:{command:codexCommand,...(process.env.PI_COFFEE_CODEX_HOME ? {env:{CODEX_HOME:process.env.PI_COFFEE_CODEX_HOME}} : {})},
        codexSessionFactory:(id:string,taskCwd:string,onBound:(nativeId:string)=>Promise<void>,environment?:()=>Promise<Record<string,string>>,preparation?:boolean)=>new CodexSessionFactory({...codexOptions,preparation,mishuContext:preparation?undefined:async()=>{const task=await workspaces.lookupByCwd(taskCwd);return task?host?.mishuSourceContext(user,task.id):undefined;},allowEmptyRecovery:async()=>{const task=await workspaces.lookupByCwd(taskCwd);return task?.workspaceKind==='chat'&&task.engine==='codex'&&task.nativeContextEmpty===true;},instructions:async()=>{const task=await workspaces.lookupByCwd(taskCwd);return instructions(task?.id);},envForSession:environment,cwd:taskCwd,mappingFile:join(bookkeeping,"codex",id+".json"),onBound:async(_hostId,nativeId)=>onBound(nativeId)}),
        legacyCodex,
        codexSummary:(taskCwd:string,id:string)=>legacyCodex!.summaryForCwd(taskCwd,id),
        codexListings:(taskCwd:string)=>legacyCodex!.listForCwd(taskCwd),
      } : {}),
      ...(process.env.PI_COFFEE_CLAUDE_COMMAND ? {claude:{command:process.env.PI_COFFEE_CLAUDE_COMMAND,env:deniedGitHub}} : {}),
      ...(process.env.PI_COFFEE_GROK_COMMAND ? {grok:{command:process.env.PI_COFFEE_GROK_COMMAND,env:deniedGitHub}} : {}),
      ...(process.env.PI_COFFEE_CURSOR_COMMAND ? {cursor:{command:process.env.PI_COFFEE_CURSOR_COMMAND,env:deniedGitHub}} : {}),
    });
    return {workdir:cwd,workspaces,factory,runners,sshme,githubAccounts,skills:{root:process.env.PI_COFFEE_SKILL_ROOT,piAgentDir:process.env.PI_COFFEE_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR,claudeDir:process.env.CLAUDE_CONFIG_DIR,bundledPiSkills:piRuntime!.skills(),...(gitea?{gitea}:{})}};
  };
  const defaultScope=wantHost ? await createScope(workdir,sessionRoot) : undefined;
  const scopeForUser = (user:string):Promise<UserScope> => createScope(resolve(workdir,user),sessionRoot ? join(sessionRoot,user) : undefined,user);
  host = !wantHost ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    runtimeStatus: piRuntime?.status,
    ...(backupCoordinator?{backup:{coordinator:backupCoordinator,repository:backupRepository,restore:restoreCoordinator,...(brokerConfig?{repositoryForActor:(actor:string|undefined,dataScope:string)=>actor?new BackupRepositoryClient({...brokerConfig,actor,dataScope}):undefined}:{binary:process.env.PI_COFFEE_RESTIC_BINARY,activationUnavailable:'Runtime secret is not isolated from unrestricted model processes'}),administrator:'awangs',scopes:envList("PI_COFFEE_BACKUP_USERS")}}:{}),
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
  if(managedAuthority){await managedAuthority.activate();await managedAuthority.startServer(backupCoordinator!);}
  const automaticCheckpoints=managedAuthority&&managedFence&&backupCoordinator?new ManagedCheckpointRefresh({coordinator:backupCoordinator,revision:()=>managedFence!.changeRevision,qualified:async()=>[...managedStores.keys()].length>0&&(await managedAuthority.sourceProof([...managedStores.keys()][0])).known,tasks:async()=>{const tasks=[];for(const [scope,store]of managedStores){for(const task of (await store.list()).conversations){if(!task.workspaceRemoved&&!task.cleanupStarted)tasks.push({scope,taskId:task.id,engine:task.engine??'pi' as const});}}return tasks;}}):undefined;
  const admissionServer=wantHost&&!managedAuthority&&process.env.PI_COFFEE_NATIVE_ADMISSION_SOCKET&&custody?await startManagedAdmissionControl({socket:process.env.PI_COFFEE_NATIVE_ADMISSION_SOCKET,allowedUid:envNumber('PI_COFFEE_NATIVE_ADMISSION_UID',-1),policy:legacyPolicy,custody}):undefined;
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
    await web?.close();
    await host?.close();
    await automaticCheckpoints?.close();await managedAuthority?.close();
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
