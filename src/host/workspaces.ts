import {checkedTaskRoot,claimTaskRoot,prepareTaskRoot,writeTaskJson} from './task-storage.js';
import type {AgentHistory} from './agent-adapter.js';
import {parseGitHubRepository} from './github.js';
import { parseAgentEngine, type AgentEngine } from "../shared/protocol.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, readlink, realpath, rm, stat, cp, lstat, appendFile, copyFile } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, normalize, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
/** `forge` is absent on Gitea Projects registered before GitHub support (ADR-0022). */
export type ProjectForge = "gitea" | "github";
export interface Project { id: string; name: string; path: string; branch: string; repoUrl?: string; repoId?: string; webUrl?: string; forge?: ProjectForge }
export interface NativeBinding { writers?:"idle"|"unknown";state:"prepared"|"starting"|"bound";id?:string;requestedId?:string}
export interface Conversation { taskRoot?:string; id: string; engine?: AgentEngine; nativeBinding?: NativeBinding; acceptedRequestIds?:string[]; projectId?: string; workspaceKind?: "chat" | "project"; vmId?:string; creationState?:"creating"|"ready"|"failed"; creationError?:string; startBranch?:string; publishStarted?:boolean; directoryCreated?:boolean; cwd: string; branch: string; archived: boolean; createdAt: string; startSha?: string; lastRemoteSha?: string; lastRemoteAt?: string; syncError?: string; pullRequest?: PullRequest; legacyCwd?:string; migrationBranch?:string; runState?: "running" | "idle" | "interrupted"; workspaceRemoved?: boolean; cleanupStarted?:boolean; artifacts?: Artifact[]; baseline?: Record<string,string>; quiesced?: boolean; turnSnapshot?: TurnSnapshot }
interface Artifact { path:string; modifiedAt:string; size:number; available:boolean }
/**
 * Working-tree tree object recorded when a run starts, so "last turn" review can
 * diff exactly what that run changed (tracked, deleted and new files).
 * `error` replaces `tree` when the snapshot could not be taken; a stale tree from
 * an older run is never kept.
 */
export interface TurnSnapshot { tree?:string; head?:string; startedAt:string; requestId?:string; error?:string }
/** Engines whose runs record a turn snapshot. Claude Code is not covered yet (owner decision 2026-09-28). */
export const TURN_SNAPSHOT_ENGINES: ReadonlySet<AgentEngine> = new Set<AgentEngine>(["pi","codex"]);
const TURN_SNAPSHOT_TIMEOUT_MS = 20000;
/** One file's patch in the Diff panel; larger files are pointed to git diff on the VM. */
export const FILE_PATCH_LIMIT = 4 * 1024 * 1024;
/** Each side's text offered for expanding unchanged context. */
export const FILE_CONTENTS_LIMIT = 1024 * 1024;
export type SideText = { text:string|null; reason?:'binary'|'too_large' };
export interface PullRequest { number:number; url:string; state:string; target:string; source:string }
export interface WorkspaceOptions { taskRoot?:string; ownerId?: string; chatRoot?: string; forge?: CodeForge; github?: GitHubForge }
export interface GitHubRepository { id:string; fullName:string; private:boolean; archived:boolean; defaultBranch:string; cloneUrl:string; webUrl:string; canPush:boolean; pushedAt?:string; description?:string }
/** GitHub API adapter (ADR-0022). Git transport still uses the VM owner's credentials. */
export interface GitHubForge {
  readonly webHost:string;
  listRepositories():Promise<GitHubRepository[]>;
  repository(fullName:string):Promise<GitHubRepository>;
  createPullRequest(project:Project,source:string,target:string,title:string):Promise<PullRequest>;
}
export interface CodeForge {
  createRepository?(name:string):Promise<{repoId:string;name:string;repoUrl:string;webUrl:string;branch:string}>;
  migrateRepository?(name:string,sourceUrl:string):Promise<{repoId:string;name:string;repoUrl:string;webUrl:string;branch:string}>;
  createPullRequest(project:Project,source:string,target:string,title:string):Promise<PullRequest>;
}
const privateName=(name:string)=> /^(\.git|\.pi|\.coffee|\.ssh|\.aws|\.env(?:\..*)?|\.npmrc|\.netrc|auth\.json|credentials(?:\..*)?)$/i.test(name);
// Project Pi Skills are source files; the rest of .pi remains private runtime data.
const privateParts=(parts:string[])=>parts.some((part,index)=>privateName(part) && !(part==='.pi' && index===0 && parts[1]==='skills' && parts.length>2));
const pythonCommand=process.platform === "win32" ? "python" : "python3";
const LF=String.fromCharCode(10),BACKSLASH=String.fromCharCode(92);
const samePath=(left:string,right:string)=> {
  const normalized=(value:string)=>normalize(resolve(value));
  const [a,b]=[normalized(left),normalized(right)];
  return process.platform === "win32" ? a.toLowerCase()===b.toLowerCase() : a===b;
};
const displayPath=(path:string)=> {
  if(!path || path.startsWith('/') || path.startsWith(BACKSLASH+BACKSLASH) || path.split('').some(char=>char.charCodeAt(0)<32))return false;
  const parts=path.split('/').flatMap(part=>part.split(BACKSLASH));
  return !parts.some(part=>part==='..' || part==='.pi-coffee') && !privateParts(parts);
};
/** Parse `git diff --name-status -z` + `--numstat -z` into reviewable files, hiding private paths. */
function diffFiles(nameStatusRaw:string,numstatRaw:string) {
  const files=new Map<string,{path:string;status:string;additions:number|null;deletions:number|null}>();
  const nameParts=nameStatusRaw.split('\0').filter(Boolean);
  for(let index=0;index+1<nameParts.length;index+=2) {
    const path=String(nameParts[index+1]);if(!displayPath(path))continue;
    const letter=String(nameParts[index])[0] ?? 'M';
    files.set(path,{path,status:letter,additions:null,deletions:null});
  }
  for(const row of numstatRaw.split('\0').filter(Boolean)) {
    const [add,del,...pathParts]=row.split('\t');const path=pathParts.join('\t');if(!displayPath(path))continue;
    const entry=files.get(path) ?? {path,status:'M',additions:null,deletions:null};
    entry.additions=add==='-' ? null : Number(add);entry.deletions=del==='-' ? null : Number(del);files.set(path,entry);
  }
  return files;
}
interface State { sidebar?: {showGroups?:boolean;assignments:Record<string,string|null>;collapsed:string[]}; version: 2; projects: Project[]; conversations: Conversation[]; legacyArchived?: string[]; deletedIds?:string[] }
const slug = (v: unknown) => { if(typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)) throw new Error('Use a project name containing letters, numbers, - or _ (1–64 characters)');return v; };
export class Workspaces {
  private state: State = {version:2,projects:[],conversations:[]};
  private tails = new Map<string, Promise<unknown>>();
  private saveTail: Promise<void> = Promise.resolve();
  private initialized = false;
  private loading?: Promise<void>;
  readonly chatRoot:string;
  private readonly ownerId:string;
  private readonly forge?:CodeForge;
  private readonly github?:GitHubForge;
  private readonly taskRoot?:string;
  constructor(readonly root: string, options:WorkspaceOptions={}) {
    this.root = resolve(root);
    this.chatRoot=resolve(options.chatRoot ?? join(this.root,"..","chats"));
    if(this.chatRoot===this.root || this.chatRoot.startsWith(this.root+"/") || this.root.startsWith(this.chatRoot+"/"))throw new Error("Chat and Project roots must be separate");
    this.ownerId=slug(options.ownerId ?? process.env.PI_COFFEE_VM_ID ?? 'vm');
    this.forge=options.forge;
    this.github=options.github;
    this.taskRoot=options.taskRoot ? resolve(options.taskRoot) : undefined;
  }
  private async load() {
    if(this.initialized)return;
    if(!this.loading)this.loading=this.loadState();
    try {await this.loading;} finally {this.loading=undefined;}
  }
  private async loadState() {
    if(this.initialized) return;
    await mkdir(this.root,{recursive:true,mode:0o700});
    await mkdir(this.chatRoot,{recursive:true,mode:0o700});
    const projectRoot=await realpath(this.root),chatRoot=await realpath(this.chatRoot);
    if(chatRoot===projectRoot || chatRoot.startsWith(projectRoot+'/') || projectRoot.startsWith(chatRoot+'/'))throw new Error('Chat and Project roots must be separate');
    await mkdir(join(this.root,'.coffee'),{recursive:true,mode:0o700});
    try {
      const data=JSON.parse(await readFile(join(this.root,'.coffee','state.json'),'utf8'));
      if(![1,2].includes(data.version) || !Array.isArray(data.projects) || !Array.isArray(data.conversations)) throw new Error('Unsupported workspace metadata');
      this.state={...data,version:2};
    } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
    for (const c of this.state.conversations) c.engine=parseAgentEngine(c.engine);
    let interrupted=false;
    for(const c of this.state.conversations) if(c.runState==="running") {c.runState="interrupted";interrupted=true;}
    for(const c of this.state.conversations)if(c.creationState==='creating'){c.creationState='failed';c.creationError='Creation interrupted; retry the same task after inspecting retained files';interrupted=true;}
    if(interrupted)await this.save();
    this.initialized=true;
  }
  private async save() {
    const next=this.saveTail.then(async()=>{
      const temp=join(this.root,'.coffee',randomUUID()+'.tmp');
      await writeFile(temp,JSON.stringify(this.state,null,2),{mode:0o600});await rename(temp,join(this.root,'.coffee','state.json'));
      for(const c of this.state.conversations)if(c.taskRoot && !c.workspaceRemoved)await writeTaskJson(c.taskRoot,'task.json',{schemaVersion:1,historyRole:'display-export-only',nativeRecovery:'Use the Agent adapter and its original native store',conversation:c}).catch(()=>console.warn('Task metadata export unavailable for '+c.id+'; registry remains authoritative'));
    });this.saveTail=next.catch(()=>undefined);return next;
  }
  /** Git operations serialize per project; only metadata publication is VM-wide. */
  private async mutate<T>(run:()=>Promise<T>, key:()=>string=()=>"registry"):Promise<T> {
    await this.load();const name=key();
    const next=(this.tails.get(name) ?? Promise.resolve()).catch(()=>undefined).then(async()=> {
      const dir=join(this.root,'.coffee','locks');await mkdir(dir,{recursive:true,mode:0o700});
      const lock=join(dir,createHash('sha256').update(name).digest('hex'));
      try { await mkdir(lock); } catch { throw new Error('Workspace operation locked. If Host restarted, inspect unfinished Git work before an administrator removes its .coffee/locks marker.'); }
      try { return await run(); } finally { await rm(lock,{recursive:true,force:true}); }
    });
    this.tails.set(name,next);
    try {return await next;} finally {if(this.tails.get(name)===next)this.tails.delete(name);}
  }
  private conversationLock(id:string) { return 'conversation:'+id; }
  private git(cwd:string,args:string[],maxBuffer=2*1024*1024) { return exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:120000,maxBuffer,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).then(r=>args.includes("-z") ? r.stdout : r.stdout.trim()); }
  private async gitBounded(cwd:string,args:string[],maxBuffer:number):Promise<string> {
    try {return await this.git(cwd,args,maxBuffer);}
    catch(error) {const stdout=(error as {stdout?:string}).stdout;if(typeof stdout==='string')return stdout;throw error;}
  }
  private async gitResult(cwd:string,args:string[],maxBuffer=2*1024*1024):Promise<{code:number;stdout:string;stderr:string}> {
    try {
      const r=await exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:120000,maxBuffer,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
      return {code:0,stdout:String(r.stdout),stderr:String(r.stderr)};
    } catch(error) {
      const e=error as NodeJS.ErrnoException & {stdout?:string;stderr?:string};
      if(typeof e.code==='number')return {code:e.code,stdout:String(e.stdout ?? ''),stderr:String(e.stderr ?? e.message)};
      throw error;
    }
  }
  private async remoteBranchSha(cwd:string,branch:string,remote='origin'):Promise<string|undefined> {
    const row=await this.git(cwd,['ls-remote','--heads',remote,`refs/heads/${branch}`]);
    return row ? row.split(/\s+/)[0] : undefined;
  }
  private async pushAndConfirm(cwd:string,branch:string,localSha:string,args:string[]):Promise<string> {
    let pushError:unknown;
    try {await this.git(cwd,['push',...args]);} catch(error) {pushError=error;}
    let remoteSha:string|undefined,lastReadError:unknown;
    for(const delay of [0,100,300]) {
      if(delay)await new Promise(resolvePromise=>setTimeout(resolvePromise,delay));
      try {remoteSha=await this.remoteBranchSha(cwd,branch);lastReadError=undefined;} catch(error) {lastReadError=error;}
      if(remoteSha===localSha)return remoteSha;
    }
    if(pushError)throw pushError;
    if(lastReadError)throw lastReadError;
    throw new Error('Remote did not confirm the checkpoint SHA');
  }
  private project(id:string|undefined) { const p=this.state.projects.find(p=>p.id===id);if(!p)throw new Error('Unknown project');return p; }
  private conversation(id:string) { const c=this.state.conversations.find(c=>c.id===id);if(!c)throw new Error('Unknown workspace');return c; }
  /** Sidebar placement is independent of execution identity and never performs Git work. */
  async moveSidebar(id:string,projectId:unknown) { return this.mutate(async()=>{
    if(projectId!==null && typeof projectId!=='string')throw new Error('Invalid sidebar project');
    if(projectId!==null)this.project(projectId);
    const sidebar=this.state.sidebar ?? {assignments:{},collapsed:[]};
    this.state.sidebar={...sidebar,assignments:{...sidebar.assignments,[id]:projectId}};
    await this.save();return this.state.sidebar;
  }); }
  async displaySidebar(showGroups:unknown) { return this.mutate(async()=>{
    if(typeof showGroups!=='boolean')throw new Error('Invalid sidebar display preference');
    this.state.sidebar={...(this.state.sidebar ?? {assignments:{},collapsed:[]}),showGroups};
    await this.save();return this.state.sidebar;
  }); }
  async collapseSidebar(projectId:unknown,collapsed:unknown) { return this.mutate(async()=>{
    if(typeof projectId!=='string' || typeof collapsed!=='boolean')throw new Error('Invalid sidebar collapse');
    this.project(projectId);
    const sidebar=this.state.sidebar ?? {assignments:{},collapsed:[]};
    this.state.sidebar={...sidebar,collapsed:[...sidebar.collapsed.filter(id=>id!==projectId),...(collapsed?[projectId]:[])]};
    await this.save();return this.state.sidebar;
  }); }
  async list() { await this.load();await this.saveTail;return {...structuredClone(this.state),vmId:this.ownerId,capabilities:{chatWorkspaces:true,forges:{gitea:Boolean(this.forge),github:Boolean(this.github)}}}; }
  async lookup(id:string) { await this.load();return this.state.conversations.find(c=>c.id===id); }
  async branches(projectId:string):Promise<string[]> {
    await this.load();const p=this.project(projectId);if(!p.repoUrl)throw new Error('Project has no remote repository');
    const rows=await this.git(this.root,['ls-remote','--heads',p.repoUrl]);
    return rows.split('\n').filter(Boolean).map(row=>row.split('\t')[1].replace(/^refs\/heads\//,'')).sort();
  }
  async registerProject(name:unknown,repoUrl:string,branch='main',repoId?:string,webUrl?:string) {return this.mutate(async()=>{
    const safe=slug(name);this.assertProjectAvailable(safe,repoId);return this.registerProjectUnlocked(safe,repoUrl,branch,repoId,webUrl);
  });}
  /** Repositories the Host's GitHub token can see, marked with the Project that already registers them. */
  async githubRepositories() {
    await this.load();
    if(!this.github)throw new Error('GitHub is not configured on this Host (set PI_COFFEE_GITHUB_TOKEN)');
    const registered=new Map(this.state.projects.filter(p=>p.forge==='github' && p.repoId).map(p=>[p.repoId,p.id]));
    return (await this.github.listRepositories()).map(repo=>({...repo,...(registered.has(repo.id) ? {projectId:registered.get(repo.id)} : {})}));
  }
  /**
   * Register a GitHub repository as a Work Project. Idempotent per GitHub repository ID; a rename refreshes
   * the stored name and URLs. Requires push access (the task branch is pushed there) and verifies that the
   * VM's own Git credentials can read the repository before anything is recorded.
   */
  async registerGitHubProject(input:unknown) {return this.mutate(async()=>{
    const github=this.github;if(!github)throw new Error('GitHub is not configured on this Host (set PI_COFFEE_GITHUB_TOKEN)');
    const repo=await github.repository(parseGitHubRepository(input,github.webHost));
    if(repo.archived)throw new Error(`GitHub repository ${repo.fullName} is archived`);
    if(!repo.canPush)throw new Error(`The Host GitHub token cannot push to ${repo.fullName}; choose a repository it can write to`);
    if(!repo.cloneUrl)throw new Error('GitHub did not return a clone URL');
    const existing=this.state.projects.find(p=>p.forge==='github' && p.repoId===repo.id);
    const repoUrl=await this.validateRepository(repo.cloneUrl,repo.defaultBranch).catch(error=>{
      throw new Error(`VM Git cannot read ${repo.fullName}. Configure GitHub credentials for the VM owner's Git (for example \`gh auth setup-git\`). ${error instanceof Error ? error.message.slice(0,200) : ''}`.trim());
    });
    if(existing){existing.name=repo.fullName;existing.repoUrl=repoUrl;existing.webUrl=repo.webUrl;existing.branch=repo.defaultBranch;await this.save();return structuredClone(existing);}
    if(this.state.projects.some(p=>p.name===repo.fullName))throw new Error('Project is already registered');
    const project:Project={id:`github-${repo.id}`,name:repo.fullName,path:'',branch:repo.defaultBranch,repoUrl,repoId:repo.id,webUrl:repo.webUrl,forge:'github'};
    this.state.projects.push(project);await this.save();return structuredClone(project);
  });}
  async bindProjectRepository(projectId:string,repoUrl:string,repoId?:string,webUrl?:string) {return this.mutate(async()=>{
    const p=this.project(projectId);const registered=await this.validateRepository(repoUrl,p.branch);
    p.repoUrl=registered;p.repoId=repoId ?? p.repoId;p.webUrl=webUrl ?? p.webUrl;await this.save();return p;
  });}
  async migrationPlan(id:string) {await this.load();const c=this.conversation(id),p=this.project(c.projectId);const dirty=Boolean(await this.git(c.cwd,['status','--porcelain=v1','--untracked-files=all']).catch(()=>''));
    return {required:!c.startSha || !samePath(c.cwd,join(this.root,'checkouts',c.id)),dirty,remoteBound:Boolean(p.repoUrl),legacyCwd:c.cwd,branch:c.branch,runState:c.runState ?? 'idle'};
  }
  async migrateConversation(id:string) {return this.mutate(async()=>{
    const c=this.conversation(id),p=this.project(c.projectId);if(!p.repoUrl)throw new Error('Bind the legacy Project to Gitea before migration');
    if(c.runState==='running')throw new Error('Stop the Conversation before migration');
    if(c.startSha && samePath(c.cwd,join(this.root,'checkouts',c.id)))return c;
    const legacyCwd=c.cwd,head=await this.git(legacyCwd,['rev-parse','HEAD']);
    const branch=`coffee/${this.ownerId}/${id}`;
    if(c.migrationBranch && c.migrationBranch!==branch)throw new Error('Legacy migration metadata does not match this VM identity');
    if(!c.migrationBranch){c.migrationBranch=branch;await this.save();}
    const published=await this.remoteBranchSha(legacyCwd,branch,p.repoUrl);
    if(published && published!==head)throw new Error('Conversation branch already exists on Gitea at a different SHA');
    if(!published)await this.git(legacyCwd,['push',`--force-with-lease=refs/heads/${branch}:`,p.repoUrl,`HEAD:refs/heads/${branch}`]);
    const temporary=join(this.root,'.coffee','migration',randomUUID()),destination=join(this.root,'checkouts',id);
    if(await stat(destination).then(()=>true,()=>false))throw new Error('Migration destination already exists; inspect it before retrying');
    await mkdir(join(this.root,'.coffee','migration'),{recursive:true});await mkdir(join(this.root,'checkouts'),{recursive:true});
    try {
      await this.git(this.root,['-c','protocol.file.allow=always','clone','--origin','origin','--branch',branch,'--',p.repoUrl,temporary]);
      if(await this.git(temporary,['rev-parse','HEAD'])!==head)throw new Error('Migrated remote branch does not match the legacy head');
      await cp(legacyCwd,temporary,{recursive:true,force:true,filter:source=>basename(source)!=='.git'});
      await rename(temporary,destination);
      c.legacyCwd=legacyCwd;c.cwd=destination;c.branch=branch;c.startSha=head;c.lastRemoteSha=head;c.lastRemoteAt=new Date().toISOString();delete c.migrationBranch;delete c.syncError;await this.save();return c;
    } catch(error) {await rm(temporary,{recursive:true,force:true});throw error;}
  },()=>this.conversationLock(id));}
  async discover() { return this.mutate(async()=> {
    if(!this.forge?.createRepository)throw new Error('Gitea project adapter is required to import local repositories');
    for(const dir of await readdir(this.root,{withFileTypes:true})) {
      if(!dir.isDirectory() || dir.name.startsWith('.')) continue;
      let path:string,branch:string;
      try {
        path=await realpath(join(this.root,dir.name));
        if(!samePath(await this.git(path,['rev-parse','--show-toplevel']),path))continue;
        branch=await this.git(path,['symbolic-ref','--short','HEAD']);
      } catch {continue; /* Not a standalone Git project. */}
      if(this.state.projects.some(project=>project.name===dir.name))continue;
      const registration=await this.forge.createRepository(slug(dir.name));
      await this.git(path,['push',registration.repoUrl,`HEAD:refs/heads/${branch}`]);
      this.state.projects.push({id:registration.repoId,name:dir.name,path:'',branch,repoUrl:registration.repoUrl,repoId:registration.repoId,webUrl:registration.webUrl});
    }
    await this.save();return structuredClone(this.state.projects);
  }); }
  async createProject(name:unknown, url?:string, archive?:string) { return this.mutate(async()=> {
    const safe=slug(name);this.assertProjectAvailable(safe);
    if(url && this.forge?.migrateRepository) {
      const registration=await this.forge.migrateRepository(safe,url);
      const p={id:registration.repoId,name:safe,path:'',branch:registration.branch,repoUrl:registration.repoUrl,repoId:registration.repoId,webUrl:registration.webUrl};this.state.projects.push(p);await this.save();return p;
    }
    if(url && !this.forge)return this.registerProjectUnlocked(safe,url);
    if(!this.forge?.createRepository)throw new Error('Gitea project adapter is not configured');
    const registration=await this.forge.createRepository(safe);
    const path=join(this.root,'.coffee','imports',randomUUID());await mkdir(path,{recursive:true});
    try {
      if(archive)await exec(pythonCommand,[fileURLToPath(new URL('./import-zip.py',import.meta.url)),archive,path],{timeout:60000,maxBuffer:1024*1024});
      await this.git(path,['init','-b',registration.branch]);
      await this.git(path,['var','GIT_AUTHOR_IDENT']).catch(()=>{throw new Error('Configure Git user.name and user.email in the VM before initializing a repository');});
      await this.git(path,['add','--all']);await this.git(path,['commit','--allow-empty','-m','Initialize project']);
      await this.git(path,['remote','add','origin',registration.repoUrl]);await this.git(path,['push','-u','origin',registration.branch]);
      const p={id:registration.repoId,name:safe,path:'',branch:registration.branch,repoUrl:registration.repoUrl,repoId:registration.repoId,webUrl:registration.webUrl};this.state.projects.push(p);await this.save();return p;
    } catch(e) {throw new Error(`Project creation failed; the Gitea repository was retained for inspection. ${e instanceof Error ? e.message.slice(0,300) : ''}`);}
    finally {await rm(path,{recursive:true,force:true});}
  }); }
  private async registerProjectUnlocked(name:string,repoUrl:string,branch='main',repoId?:string,webUrl?:string) {
    const normalized=await this.validateRepository(repoUrl,branch);
    const project={id:repoId ?? randomUUID(),name,path:'',branch,repoUrl:normalized,...(repoId?{repoId}:{}),...(webUrl?{webUrl}:{})};this.state.projects.push(project);await this.save();return project;
  }
  /** Names are unique across forges; repository IDs only within one forge (Gitea and GitHub IDs overlap). */
  private assertProjectAvailable(name:string,repoId?:string,forge:ProjectForge='gitea') {
    if(this.state.projects.some(project=>project.name===name || (repoId && project.repoId===repoId && (project.forge ?? 'gitea')===forge)))throw new Error('Project is already registered');
  }
  private async validateRepository(repoUrl:string,branch:string) {
    if(!repoUrl || /[\r\n\0]/.test(repoUrl))throw new Error('Repository URL is required');
    const normalized=/^(https?:\/\/|ssh:\/\/|git@[a-zA-Z0-9.-]+:)/.test(repoUrl) ? repoUrl : resolve(repoUrl);
    if(/^https?:/.test(normalized) && (new URL(normalized).username || new URL(normalized).password))throw new Error('Use VM Git credential storage, not URL credentials');
    await this.git(this.root,['-c','protocol.file.allow=always','ls-remote','--exit-code','--heads',normalized,branch]);return normalized;
  }
  private assertId(id:string) {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw new Error('Invalid conversation ID');
    if(this.state.deletedIds?.includes(id))throw new Error('Conversation was permanently deleted');
  }
  private async checkDirectory(c:Conversation) {
    if(c.workspaceRemoved || c.cleanupStarted || c.creationState==='failed' || c.creationState==='creating')throw new Error(c.creationError || 'Workspace is not ready');
    if(c.taskRoot){await checkedTaskRoot(c.taskRoot);if(c.cwd!==join(c.taskRoot,'workspace'))throw new Error('Task workspace path changed');}
    const info=await lstat(c.cwd).catch(()=>undefined);
    if(!info?.isDirectory() || info.isSymbolicLink())throw new Error('Workspace directory unavailable; restore it explicitly');
    return c.cwd;
  }
  async dataRoot(id:string) {
    await this.load();const c=this.conversation(id);await this.checkDirectory(c);
    if(c.taskRoot){await prepareTaskRoot(c.taskRoot);return c.taskRoot;}
    const root=c.workspaceKind==='chat' ? c.cwd : join(c.cwd,'.pi-coffee');
    await mkdir(root,{recursive:true,mode:0o700});
    if(relative(await realpath(c.cwd),await realpath(root))!==(c.workspaceKind==='chat' ? '' : '.pi-coffee'))throw new Error('Workspace data directory is outside its registered path');
    for(const dir of ['inbox','artifacts','research','images']) {
      const path=join(root,dir);await mkdir(path,{recursive:true,mode:0o700});
      if(relative(await realpath(root),await realpath(path))!==dir)throw new Error('Workspace data directory is outside its registered path');
    }
    if(c.workspaceKind!=='chat') {
      const exclude=resolve(c.cwd,await this.git(c.cwd,['rev-parse','--git-path','info/exclude']));
      await mkdir(dirname(exclude),{recursive:true});
      if(!(await readFile(exclude,'utf8').catch(()=>'' )).split('\n').includes('/.pi-coffee/'))await appendFile(exclude,'\n/.pi-coffee/\n');
    }
    return root;
  }
  async inboxDirectory(id:string) {
    const c=await this.lookup(id);const root=await this.dataRoot(id);
    return join(root,c?.taskRoot?'attachments':'inbox');
  }
  async exportHistory(id:string,history:AgentHistory) {
    const c=await this.lookup(id);if(!c?.taskRoot || c.workspaceRemoved || c.cleanupStarted)return;
    await checkedTaskRoot(c.taskRoot);
    await writeTaskJson(join(c.taskRoot,'history'),'conversation.json',{schemaVersion:1,role:'display-export-only',conversationId:id,engine:c.engine ?? 'pi',exportedAt:new Date().toISOString(),...history});
  }
  async setNativeBinding(id:string,binding:NativeBinding) {return this.mutate(async()=>{
    const c=this.conversation(id);
    if(c.nativeBinding?.id && c.nativeBinding.id!==binding.id)throw new Error("Native Session binding cannot change");
    c.nativeBinding=binding;await this.save();
  },()=>this.conversationLock(id));}
  async runtimeEnvironment(id:string):Promise<Record<string,string>> {
    const c=await this.lookup(id);if(!c)throw new Error('Unknown workspace');
    const root=await this.dataRoot(id),subagentRoot=join(root,'artifacts','subagent-runs');
    await mkdir(subagentRoot,{recursive:true,mode:0o700});
    return {PI_COFFEE_DATA_ROOT:root,PI_COFFEE_WORKSPACE_CWD:c.cwd,PI_COFFEE_INITIAL_MODE:c.workspaceKind==='chat'?'chat':'work',PI_SUBAGENTS_TEMP_ROOT:subagentRoot};
  }
  async createChatConversation(id=randomUUID(), engine:AgentEngine="pi") {return this.mutate(async()=>{
    this.assertId(id);let c=this.state.conversations.find(c=>c.id===id);
    if(c && (c.engine ?? 'pi')!==engine)throw new Error('Task Agent is fixed at creation');
    if(c && c.workspaceKind!=='chat')throw new Error('Creation ID belongs to a different task');
    if(!c && engine!=='pi')throw new Error('Chat is available only with Pi; choose Work instead');
    if(c && (!c.creationState || c.creationState==='ready')){await this.checkDirectory(c);return structuredClone(c);}
    const cwd=c?.cwd ?? (this.taskRoot ? join(this.taskRoot,id,'workspace') : join(this.chatRoot,id));
    if(!c){
      if(await lstat(cwd).then(()=>true,()=>false))throw new Error('Chat directory already exists; inspect it before retrying');
      const taskRoot=this.taskRoot ? await claimTaskRoot(this.taskRoot,id) : undefined;
      c={...(taskRoot?{taskRoot}:{}),id,engine,workspaceKind:'chat',vmId:this.ownerId,cwd,branch:'',archived:false,createdAt:new Date().toISOString(),creationState:'creating'};
      this.state.conversations.push(c);await this.save();
    }
    try {
      if(!c.directoryCreated){await mkdir(cwd,{mode:0o700});c.directoryCreated=true;await this.save();}
      if(!(await lstat(cwd)).isDirectory())throw new Error('Chat directory unavailable');
      c.creationState='ready';await this.dataRoot(id);delete c.creationError;await this.save();return structuredClone(c);
    }catch(error){c.creationState='failed';c.creationError=`Creation failed; retained directory: ${cwd}. ${error instanceof Error ? error.message : 'Inspect before retrying'}`;await this.save();throw new Error(c.creationError);}
  },()=>this.conversationLock(id));}
  async createConversation(projectId:string, branch?:string, id=randomUUID(), engine:AgentEngine="pi") {return this.mutate(async()=>{
    this.assertId(id);const p=this.project(projectId),from=branch || p.branch;
    let c=this.state.conversations.find(c=>c.id===id);
    if(c && (c.engine ?? 'pi')!==engine)throw new Error('Task Agent is fixed at creation');
    if(c && (c.projectId!==projectId || (c.startBranch && c.startBranch!==from)))throw new Error('Creation ID belongs to a different task');
    if(c && (!c.creationState || c.creationState==='ready')){await this.checkDirectory(c);return structuredClone(c);}
    if(!p.repoUrl)throw new Error('Project must be registered to Gitea or GitHub before creating a code Conversation');
    await this.git(this.root,['check-ref-format','--branch',from]);
    const cwd=c?.cwd ?? (this.taskRoot ? join(this.taskRoot,id,'workspace') : join(this.root,'checkouts',id)),ownedBranch=`coffee/${this.ownerId}/${id}`;
    await mkdir(join(this.root,'checkouts'),{recursive:true,mode:0o700});
    if(!c) {
      if(await lstat(cwd).then(()=>true,()=>false))throw new Error('Checkout destination already exists; inspect it before retrying');
      const taskRoot=this.taskRoot ? await claimTaskRoot(this.taskRoot,id) : undefined;
      c={...(taskRoot?{taskRoot}:{}),id,engine,projectId,workspaceKind:'project',vmId:this.ownerId,cwd,branch:ownedBranch,startBranch:from,archived:false,createdAt:new Date().toISOString(),creationState:'creating'};
      this.state.conversations.push(c);await this.save();
    }
    c.creationState='creating';delete c.creationError;await this.save();
    try {
      if(!await lstat(cwd).then(()=>true,()=>false)) {
        await this.git(this.root,['-c','protocol.file.allow=always','clone','--origin','origin','--branch',from,'--',p.repoUrl,cwd]);
      } else {
        if((await lstat(cwd)).isSymbolicLink() || await this.git(cwd,['remote','get-url','origin'])!==p.repoUrl)throw new Error('Failed creation directory changed; inspect it before retrying');
        if(await this.git(cwd,['status','--porcelain']))throw new Error('Failed creation contains local changes; preserve them before retrying');
      }
      const head=await this.git(cwd,['rev-parse','HEAD']);
      if(c.startSha && c.startSha!==head)throw new Error('Failed creation HEAD changed; inspect before retrying');
      c.startSha=head;
      const remote=await this.remoteBranchSha(cwd,ownedBranch);
      if(remote && (!c.publishStarted || remote!==head))throw new Error('Conversation branch already exists on the remote; use a new Conversation ID');
      const current=await this.git(cwd,['symbolic-ref','--short','HEAD']);
      if(current!==ownedBranch){if(current!==from)throw new Error('Failed creation branch changed');await this.git(cwd,['checkout','-b',ownedBranch]);}
      c.publishStarted=true;await this.save();
      await this.pushAndConfirm(cwd,ownedBranch,head,['--set-upstream',`--force-with-lease=refs/heads/${ownedBranch}:${remote ?? ''}`,'origin',`HEAD:refs/heads/${ownedBranch}`]);
      c.lastRemoteSha=head;c.lastRemoteAt=new Date().toISOString();c.baseline={};
      for(const path of (await this.git(cwd,['ls-files','-z'])).split('\0').filter(Boolean).slice(0,5000)) {
        if(!/\.(png|jpe?g|gif|webp|svg|md|pdf)$/i.test(path))continue;
        try {const info=await stat(join(cwd,path));c.baseline[path]=`${info.mtimeMs}:${info.size}`;}catch{}
      }
      c.creationState='ready';await this.dataRoot(id);await this.save();return structuredClone(c);
    } catch(error) {
      c.creationState='failed';c.creationError=`Creation failed; retained directory: ${cwd}. ${error instanceof Error ? error.message.slice(0,500) : 'Inspect before retrying'}`;await this.save();throw new Error(c.creationError);
    }
  },()=>this.conversationLock(id));}
  async cwd(id:string) { const c=await this.lookup(id);if(!c)throw new Error('Create a task before prompting');if(c.archived || c.workspaceRemoved)throw new Error('Restore the archived conversation first (pending deletion cannot be resumed)');return this.checkDirectory(c); }
  async markRun(id:string, runState:"running"|"idle"|"interrupted",requestId?:string) {return this.mutate(async()=>{
    const c=this.state.conversations.find(c=>c.id===id);if(!c)return;
    if(runState==="running" && c.archived)throw new Error("Conversation archived");
    if(requestId && c.engine && c.engine!=="pi") {
      if(c.acceptedRequestIds?.includes(requestId))throw new Error("This request was already accepted; it was not replayed. Inspect native history before retrying with a new request.");
      c.acceptedRequestIds=[...(c.acceptedRequestIds??[]),requestId].slice(-256);
    }
    if(runState==="running" && this.recordsTurns(c)) {
      // Taken before the Agent receives the prompt; a failure never blocks the run
      // and never leaves an older run's tree in place.
      const startedAt=new Date().toISOString();
      try {c.turnSnapshot={...await this.workingTree(c.cwd),startedAt,...(requestId?{requestId}:{})};}
      catch(error) {c.turnSnapshot={startedAt,error:(error instanceof Error ? error.message : 'Snapshot failed').slice(0,300)};}
    }
    c.runState=runState;await this.save();
  },()=>this.state.conversations.some(c=>c.id===id) ? this.conversationLock(id) : 'legacy:'+id);}
  private recordsTurns(c:Conversation) {
    return c.workspaceKind!=='chat' && TURN_SNAPSHOT_ENGINES.has(c.engine ?? 'pi') && (!c.creationState || c.creationState==='ready') && !c.workspaceRemoved && !c.cleanupStarted;
  }
  /**
   * Tree object for the whole working tree (tracked edits, deletions and new
   * non-ignored files) written through a throwaway index, so the checkout's own
   * index, HEAD and refs are untouched. Runtime data under .pi-coffee is excluded.
   */
  private async workingTree(cwd:string):Promise<{tree:string;head?:string}> {
    const gitPath=async(name:string)=>resolve(cwd,await this.git(cwd,['rev-parse','--git-path',name]));
    const index=await gitPath('pi-coffee-snapshot-'+randomUUID()+'.index');
    const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_INDEX_FILE:index};
    const run=(args:string[])=>exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:TURN_SNAPSHOT_TIMEOUT_MS,maxBuffer:2*1024*1024,env}).then(r=>r.stdout.trim());
    try {
      // Reusing the real index's stat cache keeps large, mostly unchanged checkouts fast.
      await copyFile(await gitPath('index'),index).catch(()=>undefined);
      // Git rejects an exclude pathspec that names an ignored path, so exclude runtime
      // data explicitly only when info/exclude does not already hide it.
      const runtimeIgnored=(await this.gitResult(cwd,['check-ignore','-q','.pi-coffee/'])).code===0;
      await run(['add','-A','--','.',...(runtimeIgnored ? [] : [':(exclude).pi-coffee'])]);
      const tree=await run(['write-tree']);
      const head=await this.git(cwd,['rev-parse','--verify','--quiet','HEAD']).catch(()=>'');
      return {tree,...(head?{head}:{})};
    } finally {await rm(index,{force:true});await rm(index+'.lock',{force:true});}
  }
  /** Read-only view of what the latest (or running) turn changed, from its start snapshot to now. */
  async turnChanges(id:string) {
    await this.load();
    const c=this.conversation(id);
    if(c.workspaceKind==='chat')throw new Error('Chat workspace has no project Diff');
    if(!TURN_SNAPSHOT_ENGINES.has(c.engine ?? 'pi'))throw new Error('Last-turn Diff is not available for this Agent yet');
    await this.checkDirectory(c);
    const snapshot=c.turnSnapshot;
    if(!snapshot?.tree)throw new Error(snapshot?.error ? 'Last-turn snapshot unavailable: '+snapshot.error : 'No turn recorded yet; send a message first');
    if((await this.gitResult(c.cwd,['cat-file','-e',snapshot.tree+'^{tree}'])).code!==0)throw new Error('Last-turn snapshot is no longer available');
    const now=await this.workingTree(c.cwd);
    const range=[snapshot.tree,now.tree];
    const nameStatusRaw=await this.git(c.cwd,['diff','--no-ext-diff','--no-textconv','--name-status','--no-renames','-z',...range,'--']);
    const numstatRaw=await this.git(c.cwd,['diff','--no-ext-diff','--no-textconv','--numstat','--no-renames','-z',...range,'--']);
    const files=diffFiles(nameStatusRaw,numstatRaw);
    const paths=[...files.keys()];
    const patchParts:string[]=[];
    // Never pass an empty pathspec: private paths were filtered above.
    for(let index=0;index<paths.length;index+=250)patchParts.push(await this.gitBounded(c.cwd,['diff','--no-ext-diff','--no-textconv',...range,'--',...paths.slice(index,index+250)],8*1024*1024));
    const patch=patchParts.filter(Boolean).join('\n'),limit=150000;
    return {
      scope:'turn' as const,sessionId:id,projectId:c.projectId,branch:c.branch,base:snapshot.tree,target:now.tree,
      startedAt:snapshot.startedAt,running:c.runState==='running',stale:false,refreshedAt:new Date().toISOString(),
      files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),
      patch:patch.slice(0,limit),truncated:patch.length>limit,
    };
  }
  async settleRuns(isBusy:(id:string)=>boolean|undefined) {
    await this.load();
    if(!this.state.conversations.some(c=>c.runState==="running" && isBusy(c.id)===false))return;
    for(const c of this.state.conversations)if(c.runState==="running" && isBusy(c.id)===false)c.runState="idle";await this.save();
  }
  async isArchived(id:string) {await this.load();return Boolean(this.state.conversations.find(c=>c.id===id)?.archived || this.state.legacyArchived?.includes(id));}
  async archiveLegacy(id:string, archived:boolean) {return this.mutate(async()=>{
    const values=new Set(this.state.legacyArchived ?? []);if(archived)values.add(id);else values.delete(id);this.state.legacyArchived=[...values];await this.save();return {id,archived,legacy:true};
  },()=>'legacy:'+id);}
  async archive(id:string, archived:boolean, quiesced=false) {return this.mutate(async()=> {const c=this.conversation(id);if(c.workspaceRemoved)throw new Error("Deletion partially completed; retry permanent deletion");c.archived=archived;c.quiesced=archived && quiesced;await this.save();return c;},()=>this.conversationLock(id));}
  async syncStatus(id:string, refresh=true) {return this.mutate(async()=>{
    const c=this.conversation(id);
    await this.checkDirectory(c);
    if(c.workspaceKind==='chat')return {state:'local' as const,dirty:false,branch:'',lastRemoteAt:undefined,remoteSha:undefined};
    const actualBranch=await this.git(c.cwd,['symbolic-ref','--short','HEAD']).catch(()=> 'detached HEAD');
    if(actualBranch!==c.branch)return {state:'branch_mismatch' as const,dirty:true,branch:actualBranch,assignedBranch:c.branch,lastRemoteAt:c.lastRemoteAt,remoteSha:c.lastRemoteSha};
    const localSha=await this.git(c.cwd,['rev-parse','HEAD']);
    const dirty=Boolean(await this.git(c.cwd,['status','--porcelain=v1','--untracked-files=all']));
    let remoteSha:string|undefined;
    try {
      if(refresh)await this.git(c.cwd,['fetch','--prune','origin']);
      const remote=await this.git(c.cwd,['ls-remote','--heads','origin',`refs/heads/${c.branch}`]);
      remoteSha=remote ? remote.split(/\s+/)[0] : undefined;
      let state:'unpublished'|'synced'|'ahead'|'behind'|'diverged' = remoteSha ? 'diverged' : 'unpublished';
      if(remoteSha===localSha)state='synced';
      else if(remoteSha) {
        const remoteAncestor=(await this.gitResult(c.cwd,['merge-base','--is-ancestor',remoteSha,localSha])).code===0;
        const localAncestor=(await this.gitResult(c.cwd,['merge-base','--is-ancestor',localSha,remoteSha])).code===0;
        state=remoteAncestor ? 'ahead' : localAncestor ? 'behind' : 'diverged';
      }
      c.lastRemoteSha=remoteSha;c.lastRemoteAt=new Date().toISOString();delete c.syncError;await this.save();
      return {state,dirty,localSha,remoteSha,lastRemoteAt:c.lastRemoteAt,branch:c.branch};
    } catch(error) {
      c.syncError=error instanceof Error ? error.message.slice(0,500) : 'Remote status failed';await this.save();
      return {state:'unknown' as const,dirty,localSha,remoteSha:c.lastRemoteSha,lastRemoteAt:c.lastRemoteAt,branch:c.branch,error:c.syncError};
    }
  },()=>this.conversationLock(id));}
  async checkpoint(id:string,paths:string[],message:string) {return this.mutate(async()=>{
    const c=this.conversation(id);
    await this.assertCodeBranch(c);
    if(c.archived)throw new Error('Restore the conversation before checkpointing');
    if(c.runState==='running')throw new Error('Stop the conversation before checkpointing');
    if(!Array.isArray(paths) || paths.length===0)throw new Error('Choose the code files to checkpoint');
    const selected=[...new Set(paths)];
    if(selected.some(path=>!displayPath(path)))throw new Error('Checkpoint contains a private or invalid path');
    if(typeof message!=='string' || !message.trim() || message.length>200)throw new Error('Checkpoint message is required (maximum 200 characters)');
    await this.git(c.cwd,['var','GIT_AUTHOR_IDENT']).catch(()=>{throw new Error('Configure Git user.name and user.email in the VM before checkpointing');});
    await this.git(c.cwd,['add','--',...selected]);
    if((await this.gitResult(c.cwd,['diff','--cached','--quiet','--'])).code===0)throw new Error('Selected files contain no checkpoint changes');
    await this.git(c.cwd,['commit','-m',message.trim(),'--',...selected]);
    const localSha=await this.git(c.cwd,['rev-parse','HEAD']);
    try {
      const remoteSha=await this.pushAndConfirm(c.cwd,c.branch,localSha,['--set-upstream','origin',`HEAD:refs/heads/${c.branch}`]);
      c.lastRemoteSha=remoteSha;c.lastRemoteAt=new Date().toISOString();delete c.syncError;await this.save();
      const dirty=Boolean(await this.git(c.cwd,['status','--porcelain=v1','--untracked-files=all']));
      return {state:'synced' as const,dirty,localSha,remoteSha,lastRemoteAt:c.lastRemoteAt,branch:c.branch};
    } catch(error) {
      c.syncError=error instanceof Error ? error.message.slice(0,500) : 'Checkpoint push failed';await this.save();throw error;
    }
  },()=>this.conversationLock(id));}
  async pushCheckpoint(id:string) {return this.mutate(async()=>{
    const c=this.conversation(id);await this.assertCodeBranch(c);if(c.archived)throw new Error('Restore the conversation before synchronizing');if(c.runState==='running')throw new Error('Stop the conversation before synchronizing');
    const current=await this.git(c.cwd,['symbolic-ref','--short','HEAD']);if(current!==c.branch)throw new Error('Checkout is not on its assigned Conversation branch');
    const localSha=await this.git(c.cwd,['rev-parse','HEAD']);
    try {
      const remoteSha=await this.pushAndConfirm(c.cwd,c.branch,localSha,['origin',`HEAD:refs/heads/${c.branch}`]);
      c.lastRemoteSha=remoteSha;c.lastRemoteAt=new Date().toISOString();delete c.syncError;await this.save();
      return {state:'synced' as const,dirty:Boolean(await this.git(c.cwd,['status','--porcelain=v1','--untracked-files=all'])),localSha,remoteSha,lastRemoteAt:c.lastRemoteAt,branch:c.branch};
    } catch(error) {c.syncError=error instanceof Error ? error.message.slice(0,500) : 'Checkpoint push failed';await this.save();throw error;}
  },()=>this.conversationLock(id));}
  private async assertCodeBranch(c:Conversation) {
    await this.checkDirectory(c);if(c.workspaceKind==='chat')throw new Error('Chat workspace has no Git synchronization');
    if(await this.git(c.cwd,['symbolic-ref','--short','HEAD']).catch(()=> '')!==c.branch)throw new Error('Checkout is not on its assigned Conversation branch');
    if(await this.git(c.cwd,['ls-files','--','.pi-coffee']))throw new Error('Runtime data is tracked; remove private .pi-coffee files from Git before checkpointing');
  }
  async openPullRequest(id:string,title:string) {return this.mutate(async()=>{
    const c=this.conversation(id),p=this.project(c.projectId);
    await this.assertCodeBranch(c);
    const forge=p.forge==='github' ? this.github : this.forge;
    if(!forge)throw new Error(p.forge==='github' ? 'GitHub pull request adapter is not configured (set PI_COFFEE_GITHUB_TOKEN)' : 'Gitea pull request adapter is not configured');
    if(typeof title!=='string' || !title.trim() || title.length>200)throw new Error('Pull request title is required (maximum 200 characters)');
    const status=await this.syncStatusUnlocked(c);
    if(status.state!=='synced')throw new Error('Push and verify the Conversation checkpoint before creating a pull request');
    c.pullRequest=await forge.createPullRequest(p,c.branch,p.branch,title.trim());await this.save();return c.pullRequest;
  },()=>this.conversationLock(id));}
  private async syncStatusUnlocked(c:Conversation) {
    const localSha=await this.git(c.cwd,['rev-parse','HEAD']);
    const remote=await this.git(c.cwd,['ls-remote','--heads','origin',`refs/heads/${c.branch}`]);
    const remoteSha=remote ? remote.split(/\s+/)[0] : undefined;
    return {state:remoteSha===localSha ? 'synced' as const : 'unsynced' as const,localSha,remoteSha};
  }
  async continueFrom(projectId:string,sourceBranch:string,expectedSha:string,id=randomUUID(),engine:AgentEngine="pi") {return this.mutate(async()=>{
    this.assertId(id);
    if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expectedSha))throw new Error('Expected remote SHA is invalid');
    if(this.state.conversations.some(c=>c.id===id))throw new Error('Conversation already exists');
    const p=this.project(projectId);if(!p.repoUrl)throw new Error('Project has no remote repository');
    await this.git(this.root,['check-ref-format','--branch',sourceBranch]);
    const taskRoot=this.taskRoot ? await claimTaskRoot(this.taskRoot,id) : undefined;
    const cwd=taskRoot ? join(taskRoot,'workspace') : join(this.root,'checkouts',id);await mkdir(dirname(cwd),{recursive:true});
    if(await stat(cwd).then(()=>true,()=>false))throw new Error('Checkout destination already exists; inspect it before retrying');
    try {
      await this.git(this.root,['-c','protocol.file.allow=always','clone','--origin','origin','--branch',sourceBranch,'--',p.repoUrl,cwd]);
      const head=await this.git(cwd,['rev-parse','HEAD']);
      if(head!==expectedSha)throw new Error('Remote checkpoint SHA changed; inspect the source before continuing');
      const branch=`coffee/${this.ownerId}/${id}`;
      if(await this.remoteBranchSha(cwd,branch))throw new Error('Conversation branch already exists on the remote; use a new Conversation ID');
      await this.git(cwd,['checkout','-b',branch]);
      await this.pushAndConfirm(cwd,branch,head,['--set-upstream',`--force-with-lease=refs/heads/${branch}:`,'origin',`HEAD:refs/heads/${branch}`]);
      const c:Conversation={...(taskRoot?{taskRoot}:{}),id,engine,projectId,workspaceKind:'project',vmId:this.ownerId,creationState:'ready',startBranch:sourceBranch,cwd,branch,archived:false,createdAt:new Date().toISOString(),startSha:head,lastRemoteSha:head,lastRemoteAt:new Date().toISOString()};this.state.conversations.push(c);await this.dataRoot(id);await this.save();return c;
    } catch(error) {await rm(cwd,{recursive:true,force:true});if(taskRoot){await checkedTaskRoot(taskRoot);await rm(taskRoot,{recursive:true});}throw error;}
  },()=>`conversation:${id}`);}
  /** Read-only change view against the last fetched target branch. */
  async changes(id:string) {
    await this.load();
    const c=this.conversation(id),p=this.project(c.projectId);
    if(c.workspaceRemoved)throw new Error('Workspace has been removed');
    const source=await this.git(c.cwd,['rev-parse','HEAD']);
    let stale=false;
    if(p.repoUrl)try{await this.git(c.cwd,['fetch','--prune','origin']);}catch{stale=true;}
    const target=p.repoUrl ? await this.git(c.cwd,['rev-parse',`refs/remotes/origin/${p.branch}`]) : await this.git(p.path,['rev-parse','HEAD']);
    const base=await this.git(c.cwd,['merge-base',target,source]);
    const trackedWorkingRaw=await this.git(c.cwd,['diff','--name-only','-z','HEAD','--']).catch(()=> '');
    const untrackedRaw=await this.git(c.cwd,['ls-files','--others','--exclude-standard','-z']).catch(()=> '');
    const nameStatusRaw=await this.git(c.cwd,['diff','--no-ext-diff','--no-textconv','--name-status','--no-renames','-z',base,'--']);
    const numstatRaw=await this.git(c.cwd,['diff','--no-ext-diff','--no-textconv','--numstat','--no-renames','-z',base,'--']);
    const files=diffFiles(nameStatusRaw,numstatRaw);
    const untracked=untrackedRaw.split('\0').filter(displayPath);
    const checkpointPaths=new Set([...trackedWorkingRaw.split('\0').filter(displayPath),...untracked]);
    for(const path of untracked)files.set(path,{path,status:'?',additions:null,deletions:null});
    const untrackedSet=new Set(untracked);
    const trackedPaths=[...files.keys()].filter(path=>!untrackedSet.has(path));
    const patchParts:string[]=[],statParts:string[]=[],checkOutputs:string[]=[];
    let checkCode=0;
    // Never pass an empty pathspec: a sensitive tracked file was filtered above,
    // and an unscoped diff would leak it back into the review payload.
    for(let index=0;index<trackedPaths.length;index+=250) {
      const paths=trackedPaths.slice(index,index+250);
      patchParts.push(await this.gitBounded(c.cwd,['diff','--no-ext-diff','--no-textconv',base,'--',...paths],8*1024*1024));
      statParts.push(await this.git(c.cwd,['diff','--no-ext-diff','--stat','--no-renames',base,'--',...paths]).catch(()=> ''));
      const result=await this.gitResult(c.cwd,['diff','--no-ext-diff','--check',base,'--',...paths]);
      if(result.code!==0){checkCode=result.code;checkOutputs.push(result.stdout || result.stderr);}
    }
    let patch=patchParts.filter(Boolean).join('\n');
    const untrackedPatches:string[]=[];
    for(const path of untracked.slice(0,100)) {
      const text=await this.untrackedPatch(id,path);if(!text)continue;
      untrackedPatches.push(text);
      // New text files count like additions so summaries do not read +0 for created files.
      const added=Number(text.match(/^@@ -0,0 \+1,(\d+) @@/m)?.[1] ?? 0);
      const entry=files.get(path);if(entry){entry.additions=added;entry.deletions=0;}
    }
    if(untrackedPatches.length)patch=(patch ? patch+'\n' : '')+untrackedPatches.join('\n');
    const stat=statParts.filter(Boolean).join('\n');
    const limit=150000;
    return {
      scope:'branch' as const,sessionId:id,projectId:c.projectId,branch:c.branch,source,target,base,stale,targetBranch:p.branch,refreshedAt:new Date().toISOString(),
      files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),
      checkpointPaths:[...checkpointPaths].sort((a,b)=>a.localeCompare(b)),
      stat:stat || 'no changes',
      patch:patch.slice(0,limit),truncated:patch.length>limit,
      checks:[{
        command:'git diff --check',ok:checkCode===0,exitCode:checkCode,
        output:(checkOutputs.join('\n') || 'clean').slice(0,20000),
      }],
    };
  }
  private async untrackedPatch(id:string,path:string,limit=256*1024):Promise<string|undefined> {
    let full:string,info:Awaited<ReturnType<typeof stat>>;
    try {full=await this.file(id,path);info=await stat(full);} catch {return undefined;}
    if(!info.isFile() || info.size>limit)return undefined;
    const content=await readFile(full,'utf8').catch(()=> undefined);if(content===undefined || content.includes('\0'))return undefined;
    const withoutTrailingNewline=content.endsWith('\n') ? content.slice(0,-1) : content;
    const lines=withoutTrailingNewline.length ? withoutTrailingNewline.split('\n') : [];
    const additions=lines.map(line=>'+'+line).join('\n');
    const hunk=lines.length===0 ? '@@ -0,0 +0,0 @@' : `@@ -0,0 +1,${lines.length} @@`;
    return ['diff --git a/'+path+' b/'+path,'new file mode 100644','index 0000000..0000000','--- /dev/null','+++ b/'+path,hunk,additions].join(LF)+(content.endsWith(LF) || lines.length===0 ? '' : LF+BACKSLASH+' No newline at end of file');
  }
  /**
   * One file of the Diff panel, loaded when it scrolls into view: its whole patch
   * (the combined `changes` patch is capped) and, when asked, both sides' text so
   * the browser can expand unchanged context. Read-only, against the same bases as
   * `changes` (the merge-base it reported, which must still be an ancestor of
   * HEAD) and `turnChanges` (the turn's start snapshot).
   */
  async changeFile(id:string,input:{scope?:unknown;path?:unknown;base?:unknown;contents?:unknown}) {
    await this.load();
    const c=this.conversation(id);
    if(c.workspaceKind==='chat')throw new Error('Chat workspace has no project Diff');
    if(c.workspaceRemoved)throw new Error('Workspace has been removed');
    const path=input.path;
    if(typeof path!=='string' || path.length>4096 || !displayPath(path))throw new Error('Invalid or private path');
    await this.checkDirectory(c);
    const turn=input.scope==='turn';
    let base:string,patch:string,tooLarge=false;
    if(turn) {
      if(!TURN_SNAPSHOT_ENGINES.has(c.engine ?? 'pi'))throw new Error('Last-turn Diff is not available for this Agent yet');
      const tree=c.turnSnapshot?.tree;
      if(!tree)throw new Error('No turn recorded yet; send a message first');
      if((await this.gitResult(c.cwd,['cat-file','-e',tree+'^{tree}'])).code!==0)throw new Error('Last-turn snapshot is no longer available');
      base=tree;patch=await this.pathAgainstWorkingTree(c.cwd,tree,path);
    } else {
      const commit=typeof input.base==='string' ? input.base : '';
      if(!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit))throw new Error('Diff base missing; refresh the Diff');
      if((await this.gitResult(c.cwd,['merge-base','--is-ancestor',commit,'HEAD'])).code!==0)throw new Error('Diff base is no longer part of the task branch; refresh the Diff');
      base=commit;
      patch=await this.gitBounded(c.cwd,['diff','--no-ext-diff','--no-textconv','--no-renames',commit,'--',path],FILE_PATCH_LIMIT);
      if(!patch && (await this.git(c.cwd,['ls-files','--others','--exclude-standard','-z','--',path]).catch(()=> '')).split('\0').includes(path)) {
        const size=(await this.file(id,path).then(full=>stat(full)).catch(()=>undefined))?.size ?? 0;
        tooLarge=size>FILE_PATCH_LIMIT;
        if(!tooLarge)patch=await this.untrackedPatch(id,path,FILE_PATCH_LIMIT) ?? '';
      }
    }
    const truncated=tooLarge || Buffer.byteLength(patch)>=FILE_PATCH_LIMIT;
    const result:{scope:'branch'|'turn';path:string;base:string;patch:string;truncated:boolean;oldContents?:string|null;newContents?:string|null;contentsUnavailable?:'binary'|'too_large'}=
      {scope:turn ? 'turn' : 'branch',path,base,patch:truncated ? '' : patch,truncated};
    if(input.contents===true && !truncated) {
      const [before,after]=await Promise.all([this.blobText(c.cwd,base,path),this.workingText(id,path)]);
      result.oldContents=before.text;result.newContents=after.text;
      const reason=before.reason ?? after.reason;if(reason)result.contentsUnavailable=reason;
    }
    return result;
  }
  /** `git diff <tree> -- <path>` against the working tree (untracked included) via a throwaway index. */
  private async pathAgainstWorkingTree(cwd:string,tree:string,path:string):Promise<string> {
    const gitPath=async(name:string)=>resolve(cwd,await this.git(cwd,['rev-parse','--git-path',name]));
    const index=await gitPath('pi-coffee-file-'+randomUUID()+'.index');
    const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_INDEX_FILE:index};
    const run=(args:string[],maxBuffer=2*1024*1024)=>exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:TURN_SNAPSHOT_TIMEOUT_MS,maxBuffer,env});
    try {
      await copyFile(await gitPath('index'),index).catch(()=>undefined);
      // A path gone from both the index and the working tree has nothing to add; the diff still shows it deleted.
      await run(['add','-A','--',path]).catch(()=>undefined);
      try {return (await run(['diff','--cached','--no-ext-diff','--no-textconv','--no-renames',tree,'--',path],FILE_PATCH_LIMIT)).stdout;}
      catch(error) {const stdout=(error as {stdout?:string}).stdout;if(typeof stdout==='string')return stdout;throw error;}
    } finally {await rm(index,{force:true});await rm(index+'.lock',{force:true});}
  }
  /** A side's text from a commit or tree; null when absent there, binary or over the limit. */
  private async blobText(cwd:string,treeish:string,path:string):Promise<SideText> {
    const spec=`${treeish}:${path}`;
    const size=await this.gitResult(cwd,['cat-file','-s',spec]);
    if(size.code!==0)return {text:null};
    if(Number(size.stdout.trim())>FILE_CONTENTS_LIMIT)return {text:null,reason:'too_large'};
    const {stdout}=await exec('git',['-c','core.hooksPath=/dev/null','cat-file','blob',spec],{cwd,timeout:120000,maxBuffer:FILE_CONTENTS_LIMIT+1024,encoding:'buffer',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    return stdout.includes(0) ? {text:null,reason:'binary'} : {text:stdout.toString('utf8')};
  }
  /** The working-tree side as Git sees it (a symlink is its target text); null when deleted. */
  private async workingText(id:string,path:string):Promise<SideText> {
    let parent:string;
    try {parent=await this.file(id,dirname(path));} catch {return {text:null};}
    const full=join(parent,basename(path)),info=await lstat(full).catch(()=>undefined);
    if(info?.isSymbolicLink())return {text:await readlink(full)};
    if(!info?.isFile())return {text:null};
    if(info.size>FILE_CONTENTS_LIMIT)return {text:null,reason:'too_large'};
    const buffer=await readFile(full);
    return buffer.includes(0) ? {text:null,reason:'binary'} : {text:buffer.toString('utf8')};
  }
  async deleteWorkspace(id:string, confirmation:string, deleteHistory:()=>Promise<unknown>=async()=>{}, includeLocalFiles=false) {return this.mutate(async()=> {
    const c=this.conversation(id),p=c.workspaceKind==='chat' ? undefined : this.project(c.projectId);
    if(c.runState==='running')throw new Error('Stop the conversation before deletion');
    if(c.taskRoot && !includeLocalFiles)throw new Error('Confirm deletion of task attachments, exports and local files');
    if(!c.archived || confirmation!==id)throw new Error('Delete requires an archived conversation and its exact ID confirmation');
    if(!c.workspaceRemoved && c.cleanupStarted && !await lstat(c.cwd).then(()=>true,()=>false))c.workspaceRemoved=true;
    if(!c.workspaceRemoved) {
    if(c.cleanupStarted || c.creationState==='failed' || c.creationState==='creating') {
      if(!includeLocalFiles)throw new Error('Confirm deletion of retained failed creation and local files');
      const info=await lstat(c.cwd).catch(()=>undefined);
      if(info?.isSymbolicLink())throw new Error('Failed creation path changed; inspect before cleanup');
      if(info){c.cleanupStarted=true;await this.save();await rm(c.cwd,{recursive:true});}
    } else {
    await this.checkDirectory(c);
    if(c.workspaceKind==='chat') {
      if(!includeLocalFiles)throw new Error('Confirm deletion of local files, attachments and artifacts');
      c.cleanupStarted=true;await this.save();await rm(c.cwd,{recursive:true});
    } else {
    if(!includeLocalFiles && (await this.scanFiles(c)).some(path=>path.startsWith('.pi-coffee/')))throw new Error('Confirm deletion of local files, attachments and artifacts');
    if(await this.git(c.cwd,['status','--porcelain']))throw new Error('Workspace has uncommitted work; preserve it before deletion');
    if(!includeLocalFiles && await this.git(c.cwd,['ls-files','--others','--ignored','--exclude-standard']))throw new Error('Confirm deletion of ignored local files');
    const head=await this.git(c.cwd,['rev-parse','HEAD']);
    if(p?.repoUrl) {
      const remote=await this.git(c.cwd,['ls-remote','--heads','origin',`refs/heads/${c.branch}`]).catch(()=>{throw new Error('Remote is unavailable; cannot prove the Checkout is recoverable');});
      if(!remote || remote.split(/\s+/)[0]!==head)throw new Error('Unpushed commits remain; checkpoint them before deleting the Checkout');
      c.cleanupStarted=true;await this.save();await rm(c.cwd,{recursive:true});
    } else {
      throw new Error('Migrate this legacy workspace to a Gitea Checkout before deleting it');
    }
    }
    }
    c.workspaceRemoved=true;await this.save();
    }
    await deleteHistory();
    if(c.taskRoot && await lstat(c.taskRoot).then(()=>true,()=>false)){await checkedTaskRoot(c.taskRoot);await rm(c.taskRoot,{recursive:true});}
    // Remote objects are retained; local files are deleted only within the confirmed scope.
    this.state.deletedIds=[...(this.state.deletedIds ?? []),id];this.state.conversations=this.state.conversations.filter(v=>v.id!==id);await this.save();return {ok:true,retained:c.workspaceKind==='chat' ? [] : ['remote branch','pull request','repository']};
  },()=>this.conversationLock(id));}
  async file(id:string,path:string) {
    const c=await this.lookup(id);if(!c)throw new Error('Unknown workspace');
    await this.checkDirectory(c);
    if(c.taskRoot && /^\.\.\/(attachments|artifacts|research|images)(?:\/|$)/.test(path)){
      await checkedTaskRoot(c.taskRoot);
      const name=path.split('/')[1],base=await checkedTaskRoot(join(c.taskRoot,name));
      const dest=await realpath(resolve(c.cwd,path)),rel=relative(base,dest);
      if(rel.startsWith('..') || isAbsolute(rel) || privateParts(rel.split(/[\\/]/)))throw new Error('Path outside task data');return dest;
    }
    const base=await realpath(c.cwd); const dest=await realpath(resolve(base,path || '.'));const rel=relative(base,dest);
    if(rel.startsWith('..') || isAbsolute(rel) || privateParts(rel.split(/[\\/]/)))throw new Error('Path outside workspace or Git internals');return dest;
  }
  async artifacts(id:string):Promise<Artifact[]> {
    await this.load();const c=this.conversation(id);if(c.workspaceRemoved)return [];
    const tracked=new Map((c.artifacts ?? []).map(a=>[a.path,{...a,available:false}]));
    const files=await this.scanFiles(c);
    for(const path of files.slice(0,5000)) {
      if(!/\.(png|jpe?g|gif|webp|svg|md|pdf)$/i.test(path) || path.replace(/^\.\.\//,'').split(/[\\/]/).some(p=>(p.startsWith('.') && p!=='.pi-coffee') || /secret|credential|token/i.test(p)))continue;
      try {
        const full=await this.file(id,path);const info=await stat(full);
        if(!info.isFile() || (c.baseline ? c.baseline[path]===`${info.mtimeMs}:${info.size}` : info.mtimeMs<Date.parse(c.createdAt)-1000))continue;
        tracked.set(path,{path,modifiedAt:info.mtime.toISOString(),size:info.size,available:true});
      } catch { /* A removed source remains a visibly unavailable metadata reference. */ }
    }
    const index=[...tracked.values()].sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)).slice(0,200);
    if(JSON.stringify(index)!==JSON.stringify(c.artifacts ?? [])){c.artifacts=index;await this.save();}
    return structuredClone(index);
  }
  private async scanFiles(c:Conversation) {
    await this.checkDirectory(c);const files:string[]=[],queue=['',...(c.taskRoot?['../attachments','../artifacts','../research','../images']:[])];let visited=0;
    while(queue.length && visited<5000) {
      const dir=queue.shift()!;
      for(const entry of await readdir(await this.file(c.id,dir),{withFileTypes:true})) {
        if(++visited>5000)break;
        if(entry.isSymbolicLink() || privateName(entry.name) || ['node_modules','.venv','.cache'].includes(entry.name))continue;
        const path=join(dir,entry.name);if(entry.isDirectory())queue.push(path);else if(entry.isFile())files.push(path);
      }
    }
    return files;
  }
  async tree(id:string,path='') {
    const dir=await this.file(id,path);const entries=await readdir(dir,{withFileTypes:true});
    return {path,entries:entries.filter(e=>!privateName(e.name) && !e.isSymbolicLink()).slice(0,1000).map(e=>({name:e.name,directory:e.isDirectory()})),truncated:entries.length>1000};
  }
}
