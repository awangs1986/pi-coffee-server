import {homedir} from "node:os";
import {RunnerManager} from "./host/runners.js";
import {hostSessionInstructions} from "./host/session-instructions.js";
import {taskRootForScope} from './host/task-storage.js';
import { NativeAgentFactory } from "./host/native/factory.js";
import { Workspaces } from "./host/workspaces.js";
import { GiteaClient } from "./host/gitea.js";
import {GitHubAccounts} from "./host/github-accounts.js";
import { HostPiRuntime } from "./host/pi-runtime.js";
import { parseUserRoutes } from "./web/identity.js";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CodexSessionFactory } from "./host/codex-adapter.js";
import { HostServer, type UserScope } from "./host/server.js";
import { RpcPiSessionFactory, type PiSessionFactory } from "./host/pi-adapter.js";
import { DEFAULT_MAX_BATCH_BYTES, DEFAULT_MAX_FILE_BYTES, TransferServer } from "./host/transfer.js";
import { RelayServer } from "./relay/server.js";
import { normalizeUsername, parseAllowedUsers, taskNamespace } from "./shared/identity.js";
import { GiteaAuth } from "./web/auth.js";
import { WebServer } from "./web/server.js";

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
  const workdir = process.env.PI_COFFEE_WORKDIR ?? process.cwd();
  let runtimeTemp:string|undefined;
  if(wantHost){
    const tempRoot=process.env.PI_COFFEE_TMP_ROOT || join(homedir(),'.cache','pi-coffee','runtime-tmp');
    await mkdir(tempRoot,{recursive:true,mode:0o700});
    runtimeTemp=await mkdtemp(join(tempRoot,'host-'));
    // Native children and their ordinary temporary-file APIs inherit disk storage.
    process.env.TMPDIR=process.env.TMP=process.env.TEMP=runtimeTemp;
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
    agentDir: process.env.PI_COFFEE_AGENT_DIR,
    provider: process.env.PI_COFFEE_PROVIDER,
    model: process.env.PI_COFFEE_MODEL,
    allowedModels: process.env.PI_COFFEE_PI_ALLOWED_MODELS === undefined ? undefined : envList("PI_COFFEE_PI_ALLOWED_MODELS", ","),
    runtime: piRuntime,
    args: ["--no-extensions"], // Only the reviewed package roots execute in Host sessions.
  };
  const sessionRoot = process.env.PI_COFFEE_SESSION_DIR?.trim();
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
  const createScope = async (cwd:string,sessionDir:string|undefined,user?:string):Promise<UserScope> => {
    await mkdir(cwd,{recursive:true});
    const workRoot=user ? cwd : process.env.PI_COFFEE_WORK_ROOT ?? cwd;
    const forge=process.env.PI_COFFEE_GITEA_URL && process.env.PI_COFFEE_GITEA_TOKEN && process.env.PI_COFFEE_GITEA_OWNER ? new GiteaClient({baseUrl:process.env.PI_COFFEE_GITEA_URL,token:process.env.PI_COFFEE_GITEA_TOKEN,owner:process.env.PI_COFFEE_GITEA_OWNER}) : undefined;
    const githubAccounts=new GitHubAccounts(join(sessionDir??join(cwd,'.pi-coffee'),'github-accounts'),{...(forge?{gitea:{url:process.env.PI_COFFEE_GITEA_URL!,token:process.env.PI_COFFEE_GITEA_TOKEN!,owner:process.env.PI_COFFEE_GITEA_OWNER!}}:{})});
    const deniedGitHub=await githubAccounts.environment(undefined);
    const workspaces=new Workspaces(user ? join(workRoot,"projects") : process.env.PI_COFFEE_PROJECT_ROOT ?? join(workRoot,"projects"),{taskRoot:taskRootForScope(process.env.PI_COFFEE_TASK_ROOT,process.env.PI_COFFEE_TASK_DEFAULT_USER,user,taskAccounts),chatRoot:user ? join(workRoot,"chats") : process.env.PI_COFFEE_CHAT_ROOT ?? join(workRoot,"chats"),ownerId:user ?? process.env.PI_COFFEE_VM_ID,forge,githubAccounts});
    await workspaces.list();
    const codexCommand=process.env.PI_COFFEE_CODEX_COMMAND ?? process.env.PI_COFFEE_CODEX_BIN ?? (agent==="codex" ? "codex" : undefined);
    const bookkeeping=sessionDir ?? join(cwd,".pi-coffee");
    const runners=new RunnerManager(sessionDir ? join(sessionDir,"runners") : join(homedir(),".local/share/pi-coffee/runners",...(user ? ["users",user] : ["default"])));
    const sshme=new RunnerManager(join(runners.root,'sshme'),'sshme');
    const instructions=async(id?:string)=>{const task=id?await workspaces.lookup(id):undefined;return [hostSessionInstructions(),task?await workspaces.forkInstructionForCwd(task.cwd):undefined].filter(Boolean).join('\n');};
    const codexOptions={env:deniedGitHub,instructions,cliPath:codexCommand,codexHome:process.env.PI_COFFEE_CODEX_HOME,model:process.env.PI_COFFEE_CODEX_MODEL ?? (agent==="codex" ? process.env.PI_COFFEE_MODEL : undefined),reasoningEffort:process.env.PI_COFFEE_CODEX_EFFORT,sandbox:codexSandbox as "read-only"|"workspace-write"|"danger-full-access",approvalPolicy:codexApproval as "never"|"on-request"|"untrusted",idleTimeoutMs,args:envList("PI_COFFEE_CODEX_ARGS",":")};
    const legacyCodex=codexCommand ? new CodexSessionFactory({...codexOptions,cwd,mappingFile:join(bookkeeping,"codex-threads.json")}) : undefined;
    const factory=new NativeAgentFactory({workspaces,instructions,
      pi:new RpcPiSessionFactory({...piOptions,instructions,cwd,sessionDir:sessionDir ?? join(bookkeeping,"sessions"),runtimeIdForSession:id=>taskNamespace(user,id),env:{...deniedGitHub,PATH:deniedGitHub.PATH+':'+piRuntime!.path(),COFFEE_MANAGED_PATH:deniedGitHub.PATH+':'+piRuntime!.path()},
        cwdForSession:async(id,existing)=>{if(await workspaces.lookup(id))return workspaces.file(id,"");if(existing)return cwd;throw new Error("Create a Chat or Work task first");},
        extensionsForSession:async id=>(await host?.mishuRuntime(user,id))?.extensions??[],
        envForSession:async id=>{const env=await workspaces.lookup(id)?await workspaces.runtimeEnvironment(id):deniedGitHub;return {...env,...(await host?.mishuRuntime(user,id))?.env,PATH:env.PATH+':'+piRuntime!.path(),COFFEE_MANAGED_PATH:env.PATH+':'+piRuntime!.path()};},
      }),
      ...(codexCommand ? {codex:{command:codexCommand,...(process.env.PI_COFFEE_CODEX_HOME ? {env:{CODEX_HOME:process.env.PI_COFFEE_CODEX_HOME}} : {})},
        codexSessionFactory:(id:string,taskCwd:string,onBound:(nativeId:string)=>Promise<void>,environment?:()=>Promise<Record<string,string>>,preparation?:boolean)=>new CodexSessionFactory({...codexOptions,preparation,instructions:async()=>[await instructions(),await workspaces.forkInstructionForCwd(taskCwd)].filter(Boolean).join('\n'),envForSession:environment,cwd:taskCwd,mappingFile:join(bookkeeping,"codex",id+".json"),onBound:async(_hostId,nativeId)=>onBound(nativeId)}),
        legacyCodex,
        codexSummary:(taskCwd:string,id:string)=>legacyCodex!.summaryForCwd(taskCwd,id),
        codexListings:(taskCwd:string)=>legacyCodex!.listForCwd(taskCwd),
      } : {}),
      ...(process.env.PI_COFFEE_CLAUDE_COMMAND ? {claude:{command:process.env.PI_COFFEE_CLAUDE_COMMAND,env:deniedGitHub}} : {}),
      ...(process.env.PI_COFFEE_GROK_COMMAND ? {grok:{command:process.env.PI_COFFEE_GROK_COMMAND,env:deniedGitHub}} : {}),
      ...(process.env.PI_COFFEE_CURSOR_COMMAND ? {cursor:{command:process.env.PI_COFFEE_CURSOR_COMMAND,env:deniedGitHub}} : {}),
    });
    return {workdir:cwd,workspaces,factory,runners,sshme,githubAccounts,skills:{root:process.env.PI_COFFEE_SKILL_ROOT,piAgentDir:process.env.PI_COFFEE_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR,claudeDir:process.env.CLAUDE_CONFIG_DIR,bundledPiSkills:piRuntime!.skills(),...(forge ? {gitea:{url:process.env.PI_COFFEE_GITEA_URL!,token:process.env.PI_COFFEE_GITEA_TOKEN!,owner:process.env.PI_COFFEE_GITEA_OWNER!}} : {})}};
  };
  const defaultScope=wantHost ? await createScope(workdir,sessionRoot) : undefined;
  const scopeForUser = (user:string):Promise<UserScope> => createScope(resolve(workdir,user),sessionRoot ? join(sessionRoot,user) : undefined,user);
  host = !wantHost ? undefined : new HostServer({
    host: envString("PI_COFFEE_HOST_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_HOST_PORT", 8788),
    token: process.env.PI_COFFEE_HOST_TOKEN,
    runtimeStatus: piRuntime?.status,
    eventBufferSize: envNumber("PI_COFFEE_EVENT_BUFFER", 256),
    idleTimeoutMs,
    requireUser: envFlag("PI_COFFEE_REQUIRE_USER"),
    transfer,
    ...defaultScope!,
    sharedSkillOwner:process.env.PI_COFFEE_SKILL_OWNER,
    scopeForUser,
  });
  if (host) await host.start();

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

  const githubOAuthClient=process.env.PI_COFFEE_GITHUB_CLIENT_ID?.trim();
  const githubOAuthSecret=process.env.PI_COFFEE_GITHUB_CLIENT_SECRET?.trim();
  if(wantWeb&&Boolean(githubOAuthClient)!==Boolean(githubOAuthSecret))throw new Error('Configure both GitHub OAuth client ID and secret');
  const web = !wantWeb ? undefined : new WebServer({
    ...(githubOAuthClient&&githubOAuthSecret?{githubOAuth:{clientId:githubOAuthClient,clientSecret:githubOAuthSecret,publicUrl:envString('PI_COFFEE_PUBLIC_URL','')}}:{}),
    host: envString("PI_COFFEE_WEB_BIND", "127.0.0.1"),
    port: envNumber("PI_COFFEE_WEB_PORT", 3000),
    hostUrl: process.env.PI_COFFEE_HOST_URL ?? `ws://127.0.0.1:${host?.address().port ?? envNumber("PI_COFFEE_HOST_PORT", 8788)}/host`,
    hostToken: process.env.PI_COFFEE_HOST_TOKEN,
    ...(webTls === undefined ? {} : { tls: webTls }),
    ...(routeFile ? {identity:{giteaUrl:giteaUrl!,clientId:giteaClientId!,clientSecret:giteaClientSecret!,publicUrl:process.env.PI_COFFEE_PUBLIC_URL!,sharedHost:process.env.PI_COFFEE_SHARED_HOST==="1",routes:()=>parseUserRoutes(readFileSync(routeFile,"utf8"))}} : {}),
    allowUnauthenticated:process.env.PI_COFFEE_ALLOW_UNAUTHENTICATED==="1",
    ...(auth === undefined ? {} : { auth }),
    ...(auth !== undefined || defaultUser === undefined ? {} : { defaultUser }),
  });
  if (web) await web.start();

  const shutdown = async () => {
    await web?.close();
    await host?.close();
    await transfer?.close();
    await relay?.close();
    if(runtimeTemp)await rm(runtimeTemp,{recursive:true,force:true});
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
