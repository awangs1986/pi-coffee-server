import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, realpath, rm, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
export interface Project { id: string; name: string; path: string; branch: string }
/** `startBranch`/`startCommit` record the exact starting point (SPEC §4.3); metadata written before 2026-09-19 lacks them. */
export interface Conversation { id: string; projectId: string; cwd: string; branch: string; archived: boolean; createdAt: string; startBranch?: string; startCommit?: string; runState?: "running" | "idle" | "interrupted"; workspaceRemoved?: boolean; artifacts?: Artifact[]; baseline?: Record<string,string>; quiesced?: boolean }
interface Artifact { path:string; modifiedAt:string; size:number; available:boolean }
/** One selectable starting point for a new conversation: a project branch, a remote-tracking branch of the VM clone, or another conversation's branch. */
export interface BranchRef { name:string; kind:"local"|"remote"|"conversation"; commit:string; committedAt?:string; default:boolean }
const CONVERSATION_BRANCH_PREFIX="coffee/";
const MAX_BRANCHES=500;
const privateName=(name:string)=> /^(\.git|\.pi|\.coffee|\.ssh|\.aws|\.env(?:\..*)?|\.npmrc|\.netrc|auth\.json|credentials(?:\..*)?)$/i.test(name);
const pythonCommand=process.platform === "win32" ? "python" : "python3";
const samePath=(left:string,right:string)=> {
  const normalized=(value:string)=>normalize(resolve(value));
  const [a,b]=[normalized(left),normalized(right)];
  return process.platform === "win32" ? a.toLowerCase()===b.toLowerCase() : a===b;
};
interface State { version: 1; projects: Project[]; conversations: Conversation[]; legacyArchived?: string[] }
interface Proposal { token: string; sessionId: string; source: string; target: string; diff: string; expires: number }
const slug = (v: unknown) => { if(typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)) throw new Error('Use a project name containing letters, numbers, - or _ (1–64 characters)');return v; };
export class Workspaces {
  private state: State = {version:1,projects:[],conversations:[]};
  private tails = new Map<string, Promise<unknown>>();
  private saveTail: Promise<void> = Promise.resolve();
  private proposals = new Map<string, Proposal>();
  private initialized = false;
  private loading?: Promise<void>;
  constructor(readonly root: string) { this.root = resolve(root); }
  private async load() {
    if(this.initialized)return;
    if(!this.loading)this.loading=this.loadState();
    try {await this.loading;} finally {this.loading=undefined;}
  }
  private async loadState() {
    if(this.initialized) return;
    await mkdir(join(this.root,'.coffee'),{recursive:true,mode:0o700});
    try {
      const data=JSON.parse(await readFile(join(this.root,'.coffee','state.json'),'utf8'));
      if(data.version!==1 || !Array.isArray(data.projects) || !Array.isArray(data.conversations)) throw new Error('Unsupported workspace metadata');
      this.state=data;
    } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
    let interrupted=false;
    for(const c of this.state.conversations) if(c.runState==="running") {c.runState="interrupted";interrupted=true;}
    if(interrupted)await this.save();
    this.initialized=true;
  }
  private async save() {
    const next=this.saveTail.then(async()=>{
      const temp=join(this.root,'.coffee',randomUUID()+'.tmp');
      await writeFile(temp,JSON.stringify(this.state,null,2),{mode:0o600});await rename(temp,join(this.root,'.coffee','state.json'));
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
  private conversationLock(id:string) { return 'project:'+this.conversation(id).projectId; }
  private git(cwd:string,args:string[]) { return exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:120000,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).then(r=>args.includes("-z") ? r.stdout : r.stdout.trim()); }
  private project(id:string) { const p=this.state.projects.find(p=>p.id===id);if(!p)throw new Error('Unknown project');return p; }
  private conversation(id:string) { const c=this.state.conversations.find(c=>c.id===id);if(!c)throw new Error('Unknown workspace');return c; }
  async list() { await this.load();await this.saveTail;return structuredClone(this.state); }
  async lookup(id:string) { await this.load();return this.state.conversations.find(c=>c.id===id); }
  async discover() { return this.mutate(async()=> {
    for(const dir of await readdir(this.root,{withFileTypes:true})) {
      if(!dir.isDirectory() || dir.name.startsWith('.') || this.state.projects.some(p=>p.path===join(this.root,dir.name))) continue;
      try {
        const path=await realpath(join(this.root,dir.name));
        if(!samePath(await this.git(path,['rev-parse','--show-toplevel']),path))continue;
        const branch=await this.git(path,['symbolic-ref','--short','HEAD']);
        this.state.projects.push({id:randomUUID(),name:dir.name,path,branch});
      } catch { /* Not a standalone Git project. */ }
    }
    await this.save();return structuredClone(this.state.projects);
  }); }
  async createProject(name:unknown, url?:string, archive?:string) { return this.mutate(async()=> {
    const safe=slug(name);const path=join(this.root,safe);await mkdir(path); // Never reuse or overwrite an existing directory.
    try {
      if(url) {
        if(!/^(https?:\/\/|ssh:\/\/|git@[a-zA-Z0-9.-]+:)/.test(url) || /[\r\n\0]/.test(url))throw new Error('Only HTTP(S) or SSH Git URLs are supported');
        if((/^https?:/.test(url) && new URL(url).username) || (/^(https?|ssh):/.test(url) && new URL(url).password))throw new Error('Use VM Git credential storage, not URL credentials');
        await this.git(this.root,['-c','protocol.file.allow=never','clone','--',url,path]);
      } else {
        if(archive) await exec(pythonCommand,[fileURLToPath(new URL('./import-zip.py',import.meta.url)),archive,path],{timeout:60000,maxBuffer:1024*1024});
        await this.git(path,['init','-b','main']);
      }
      let branch=await this.git(path,['symbolic-ref','--short','HEAD']);
      try { await this.git(path,['rev-parse','HEAD']); } catch {
        await this.git(path,['add','--all']);
        await this.git(path,['-c','user.name=PI Coffee','-c','user.email=coffee@localhost','commit','--allow-empty','-m','Initialize project']);
      }
      const p={id:randomUUID(),name:safe,path,branch};this.state.projects.push(p);await this.save();return p;
    } catch(e) { /* Retain failed import for inspection; never remove unknown concurrent user work. */ throw new Error(`Project creation failed; inspect ${path} before retrying. ${e instanceof Error ? e.message.slice(0,300) : ''}`); }
  }); }
  /**
   * Starting points offered by the bottom-bar branch selector (SPEC §1.1). Read from the VM clone only:
   * no fetch is performed, so remote-tracking branches are as fresh as the last Git operation in the VM.
   */
  async branches(projectId:string):Promise<{default:string;branches:BranchRef[]}> {
    await this.load();const p=this.project(projectId);
    const raw=await this.git(p.path,['for-each-ref','--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(symref)','refs/heads','refs/remotes']).catch(()=> '');
    const branches:BranchRef[]=[];
    for(const line of raw.split('\n')) {
      const [refname,commit,committedAt,symref]=line.split('\0');
      if(!refname || !commit || symref)continue; // symbolic refs such as origin/HEAD are aliases, not starting points
      if(refname.startsWith('refs/heads/')) {
        const name=refname.slice('refs/heads/'.length);
        branches.push({name,kind:name.startsWith(CONVERSATION_BRANCH_PREFIX) ? 'conversation' : 'local',commit,committedAt,default:name===p.branch});
      } else if(refname.startsWith('refs/remotes/')) {
        branches.push({name:refname.slice('refs/remotes/'.length),kind:'remote',commit,committedAt,default:false});
      }
    }
    const order={local:0,remote:1,conversation:2};
    branches.sort((a,b)=>Number(b.default)-Number(a.default) || order[a.kind]-order[b.kind] || (b.committedAt ?? '').localeCompare(a.committedAt ?? '') || a.name.localeCompare(b.name));
    return {default:p.branch,branches:branches.slice(0,MAX_BRANCHES)};
  }
  /** Resolve a selected starting branch to a commit: a local branch first, then a remote-tracking branch of the VM clone. Never fetches. */
  private async startCommit(projectPath:string, from:string) {
    for(const prefix of ['refs/heads/','refs/remotes/']) {
      const commit=await this.git(projectPath,['rev-parse','--verify','--quiet',`${prefix}${from}^{commit}`]).catch(()=> '');
      if(commit)return commit;
    }
    throw new Error(`Unknown branch "${from}" in the VM clone; fetch it in the VM or pick a listed branch`);
  }
  async createConversation(projectId:string, branch?:string, id=randomUUID()) { return this.mutate(async()=> {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw new Error('Invalid conversation ID');
    if(this.state.conversations.some(c=>c.id===id))throw new Error('Conversation already exists');
    const p=this.project(projectId);const from=branch || p.branch;
    await this.git(p.path,['check-ref-format','--branch',from]).catch(()=>{throw new Error(`Invalid branch name "${from}"`);});
    // A manually cloned empty repository has no commit to attach a worktree to.
    // Initialize only its unborn default branch, leaving the user's index/files untouched.
    if(from===p.branch && await this.git(p.path,['symbolic-ref','--short','HEAD']).catch(()=>'')===p.branch &&
      !await this.git(p.path,['rev-parse','--verify','HEAD']).then(()=>true,()=>false)) {
      try {await this.git(p.path,['var','GIT_AUTHOR_IDENT']);await this.git(p.path,['var','GIT_COMMITTER_IDENT']);}
      catch {throw new Error('Configure Git user.name and user.email in the VM before initializing this empty project');}
      await this.git(p.path,['commit','--allow-empty','--only','-m','Initialize project']);
    }
    const head=await this.startCommit(p.path,from);
    const cwd=join(this.root,'.worktrees',id);await mkdir(join(this.root,'.worktrees'),{recursive:true});
    const ownedBranch=`${CONVERSATION_BRANCH_PREFIX}${id}`;await this.git(p.path,['worktree','add','-b',ownedBranch,cwd,head]);
    const baseline:Record<string,string>={};
    for(const path of (await this.git(cwd,['ls-files','-z'])).split('\0').filter(Boolean).slice(0,5000)) {
      if(!/\.(png|jpe?g|gif|webp|svg|md|pdf)$/i.test(path))continue;
      try{const info=await stat(join(cwd,path));baseline[path]=`${info.mtimeMs}:${info.size}`;}catch{}
    }
    const c:Conversation={id,projectId,cwd,branch:ownedBranch,archived:false,createdAt:new Date().toISOString(),startBranch:from,startCommit:head,baseline};this.state.conversations.push(c);await this.save();return c;
  },()=>'project:'+projectId); }
  async cwd(id:string) { const c=await this.lookup(id);if(!c)throw new Error('Create a project conversation first');if(c.archived || c.workspaceRemoved)throw new Error('Restore the archived conversation first (pending deletion cannot be resumed)');return c.cwd; }
  async markRun(id:string, runState:"running"|"idle"|"interrupted") {return this.mutate(async()=>{
    const c=this.state.conversations.find(c=>c.id===id);if(!c)return;
    if(runState==="running" && c.archived)throw new Error("Conversation archived");
    c.runState=runState;await this.save();
  },()=>this.state.conversations.some(c=>c.id===id) ? this.conversationLock(id) : 'legacy:'+id);}
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
  async prepareMerge(id:string) {return this.mutate(async()=> {
    const c=this.conversation(id),p=this.project(c.projectId);
    if(c.archived)throw new Error('Restore the conversation first');
    if(await this.git(p.path,['status','--porcelain']) || await this.git(c.cwd,['status','--porcelain']))throw new Error('Commit changes in the source and clean the target before merging');
    if(await this.git(p.path,['symbolic-ref','--short','HEAD'])!==p.branch)throw new Error('Project target is not on its default branch');
    const source=await this.git(c.cwd,['rev-parse','HEAD']),target=await this.git(p.path,['rev-parse','HEAD']);
    const base=await this.git(p.path,['merge-base',target,source]);
    const diff=await this.git(p.path,['diff','--stat',base,source]);
    const patch=await this.git(p.path,['diff','--no-ext-diff','--no-textconv',base,source]);
    for(const [key,v] of this.proposals) if(v.expires<Date.now())this.proposals.delete(key);
    const proposal={token:randomUUID(),sessionId:id,source,target,diff:patch.slice(0,150000),expires:Date.now()+300000};
    this.proposals.set(proposal.token,proposal);return {...proposal,stat:diff,truncated:patch.length>150000};
  },()=>this.conversationLock(id));}
  proposalSession(token:string):string {const p=this.proposals.get(token);if(!p)throw new Error("Merge confirmation expired");return p.sessionId;}
  async merge(token:string) {return this.mutate(async()=> {
    const proposal=this.proposals.get(token);this.proposals.delete(token);
    if(!proposal || proposal.expires<Date.now())throw new Error('Merge confirmation expired or already used; inspect a new diff');
    const c=this.conversation(proposal.sessionId),p=this.project(c.projectId);
    if(c.archived || await this.git(c.cwd,['rev-parse','HEAD'])!==proposal.source || await this.git(p.path,['rev-parse','HEAD'])!==proposal.target || await this.git(p.path,['symbolic-ref','--short','HEAD'])!==p.branch || await this.git(p.path,['status','--porcelain']) || await this.git(c.cwd,['status','--porcelain'])) throw new Error('Source/target changed; inspect a new diff');
    try {
      const name=await this.git(p.path,['config','user.name']).catch(()=> 'PI Coffee');
      const email=await this.git(p.path,['config','user.email']).catch(()=> 'coffee@localhost');
      await this.git(p.path,['-c',`user.name=${name}`,'-c',`user.email=${email}`,'merge','--no-edit','--',proposal.source]); return {ok:true}; }
    catch { return {ok:false,conflict:true,message:'Merge failed or conflicted. Inspect the target workspace; nothing was reset or overwritten automatically.'}; }
  },()=>this.conversationLock(this.proposalSession(token)));}
  async deleteWorkspace(id:string, confirmation:string, deleteHistory:()=>Promise<unknown>=async()=>{}) {return this.mutate(async()=> {
    const c=this.conversation(id),p=this.project(c.projectId);
    if(!c.archived || confirmation!==id)throw new Error('Delete requires an archived conversation and its exact ID confirmation');
    if(!c.workspaceRemoved) {
    if(await this.git(c.cwd,['status','--porcelain']))throw new Error('Workspace has uncommitted work; preserve it before deletion');
    try {
      const head=await this.git(c.cwd,['rev-parse','HEAD']);
      await this.git(p.path,['merge-base','--is-ancestor',head,p.branch]);
      await this.git(p.path,['merge-base','--is-ancestor',c.branch,p.branch]);
    } catch {throw new Error('Unmerged commits remain; merge or preserve them before deletion');}
    await this.git(p.path,['worktree','remove','--',c.cwd]);
    c.workspaceRemoved=true;await this.save();
    }
    await deleteHistory();
    // Keep the branch and uploaded files: they were not included in this destructive confirmation.
    this.state.conversations=this.state.conversations.filter(v=>v.id!==id);await this.save();return {ok:true,retained:['branch','uploads','shared project']};
  },()=>this.conversationLock(id));}
  async file(id:string,path:string) {
    const c=await this.lookup(id);if(!c)throw new Error('Unknown workspace');
    const base=await realpath(c.cwd); const dest=await realpath(resolve(base,path || '.'));const rel=relative(base,dest);
    if(rel.startsWith('..') || isAbsolute(rel) || rel.split(/[\\/]/).some(privateName))throw new Error('Path outside workspace or Git internals');return dest;
  }
  async artifacts(id:string):Promise<Artifact[]> {
    await this.load();const c=this.conversation(id);if(c.workspaceRemoved)return [];
    const tracked=new Map((c.artifacts ?? []).map(a=>[a.path,{...a,available:false}]));
    const files=(await this.git(c.cwd,['ls-files','--cached','--others','--exclude=node_modules/','--exclude=.venv/','--exclude=.git/','--exclude=.coffee/','--exclude=.pi/','--exclude=.cache/','-z'])).split('\0').filter(Boolean);
    for(const path of files.slice(0,5000)) {
      if(!/\.(png|jpe?g|gif|webp|svg|md|pdf)$/i.test(path) || path.split(/[\\/]/).some(p=>p.startsWith('.') || /secret|credential|token/i.test(p)))continue;
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
  async tree(id:string,path='') {
    const dir=await this.file(id,path);const entries=await readdir(dir,{withFileTypes:true});
    return {path,entries:entries.filter(e=>!privateName(e.name) && !e.isSymbolicLink()).slice(0,1000).map(e=>({name:e.name,directory:e.isDirectory()})),truncated:entries.length>1000};
  }
}
