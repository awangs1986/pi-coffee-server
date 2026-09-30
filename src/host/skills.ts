import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,stat,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {parseDocument} from 'yaml';
import type {Workspaces} from './workspaces.js';
import {parseAgentEngine,type AgentEngine} from '../shared/protocol.js';
const exec=promisify(execFile);
const MAX_BODY=64*1024, MAX_PACKAGE=10*1024*1024, MAX_FILES=500;
export interface SkillManagerOptions {
  root?:string; home?:string; piAgentDir?:string; claudeDir?:string;
  bundledPiSkills?:string[];
  /** Test fixture seam only. Production accepts credential-free HTTP(S)/SSH URLs. */
  allowLocalSources?:boolean;
  gitea?:{url:string;token:string;owner:string};
}
interface Scope {engine:AgentEngine;scope:'user'|'project';conversationId?:string;directory:string;key:string}
interface RecordEntry {id:string;key:string;name:string;description:string;repoUrl:string;ref:string;subdir:string;revision:string;digest:string;snapshot:string;enabled:boolean;updatedAt:string}
interface DisabledNative {id:string;key:string;name:string;description:string;path:string;target:string;backup:string}
interface SkillView {id:string;name:string;description:string;path:string;managed:boolean;enabled:boolean;revision?:string;repoUrl?:string;ref?:string;subdir?:string;modified?:boolean;problem?:string;canDisable?:boolean;canRestore?:boolean}
function hash(text:string){return createHash('sha256').update(text).digest('hex');}
async function exists(path:string){try{await lstat(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
function text(value:unknown,fallback=''){if(value===undefined)return fallback;if(typeof value!=='string'||value.length>2048||/[\x00-\x1f]/.test(value))throw new Error('Invalid Skill parameter');return value;}
function inside(root:string,path:string){const r=relative(root,path);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));}
async function metadata(path:string){
 const info=await stat(path);if(info.size>MAX_BODY)throw new Error('SKILL.md exceeds 64 KB');
 const content=await readFile(path,'utf8');const match=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!match)throw new Error('SKILL.md requires YAML name and description');
 const doc=parseDocument(match[1],{uniqueKeys:true});if(doc.errors.length)throw new Error('Invalid Skill frontmatter');
 const data=doc.toJS({maxAliasCount:20});const name=data?.name,description=data?.description;
 if(typeof name!=='string'||name.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))throw new Error('Skill name must use lowercase letters, digits and single hyphens (max 64)');
 if(typeof description!=='string'||!description.trim()||description.length>1024)throw new Error('Skill description is required (max 1024 characters)');
 return {name,description:description.trim(),content};
}
/** Native Skill files stay on the VM. Web sends only scoped management commands. */
export class SkillManager {
 private readonly home:string;private readonly root:string;
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private options:SkillManagerOptions={},private workspaces?:Workspaces){this.home=resolve(options.home??homedir());this.root=resolve(options.root??join(this.home,'.local/share/pi-coffee/skills'));}
 private async scope(input:any):Promise<Scope>{
  if(!input||typeof input!=='object')throw new Error('Invalid Skill request');
  if(!['pi','codex','claude'].includes(input.engine))throw new Error('Select a Skill Agent');const engine=parseAgentEngine(input.engine);
  if(!['user','project'].includes(input.scope))throw new Error('Select user or project scope');
  let directory:string;
  if(input.scope==='project'){
   const task=await this.workspaces?.lookup(text(input.conversationId));
   if(!task||task.workspaceKind==='chat'||task.archived||task.workspaceRemoved||task.creationState==='failed')throw new Error('Select an active Work task for project Skills');
   if((task.engine??'pi')!==engine)throw new Error('Project Skill Agent must match the fixed Task Agent');
   const cwd=await this.workspaces!.file(task.id,'');directory=join(cwd,engine==='pi'?'.pi':engine==='codex'?'.agents':'.claude','skills');
  }else directory=engine==='pi'?join(this.options.piAgentDir??join(this.home,'.pi/agent'),'skills'):engine==='claude'?join(this.options.claudeDir??join(this.home,'.claude'),'skills'):join(this.home,'.agents/skills');
  directory=resolve(directory);return {engine,scope:input.scope,conversationId:input.conversationId,directory,key:hash(engine+'\0'+directory)};
 }
 private async records():Promise<RecordEntry[]>{
  try{return JSON.parse(await readFile(join(this.root,'state.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('Skill registry is unreadable; inspect it on the VM');}
 }
 private async save(records:RecordEntry[]){await this.saveFile('state.json',records);}
 private async saveFile(name:string,records:unknown){const path=join(this.root,randomUUID()+'.json');await writeFile(path,JSON.stringify(records,null,2),{mode:0o600});await rename(path,join(this.root,name));}
 private async disabledNative():Promise<DisabledNative[]>{
  try{return JSON.parse(await readFile(join(this.root,'disabled-native.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('Native Skill backups are unreadable; inspect the VM');}
 }
 /** Only self-contained native entries with real parent paths can be relocated. */
 private async nativeTarget(scope:Scope,path:string):Promise<string|undefined>{
  const target=basename(path)==='SKILL.md'?dirname(path):path;
  if(target===scope.directory||!inside(scope.directory,target)||inside(scope.directory,this.root))return;
  try{
   if(await realpath(scope.directory)!==scope.directory||await realpath(target)!==target)return;
   if(!(await lstat(target)).isDirectory()&&!(await lstat(target)).isFile())return;
   if(scope.engine==='pi')for(const bundle of this.options.bundledPiSkills??[]){
    const actual=await realpath(bundle);if(inside(actual,target)||inside(target,actual))return;
   }
   return target;
  }catch{return;}
 }
 private async mutateNative(scope:Scope,input:any){
  await mkdir(this.root,{recursive:true,mode:0o700});const lock=join(this.root,'mutation.lock');
  try{await mkdir(lock);}catch{throw new Error('Skill operation in progress or interrupted; inspect the VM Skill registry before retrying');}
  let from:string|undefined,to:string|undefined,moved=false,committed=false,safeToUnlock=true;
  try{
   const records=await this.disabledNative();let entry:DisabledNative;
   if(input.action==='disable_native'){
    const skill=(await this.list(scope)).skills.find(s=>s.id===input.id&&s.enabled&&!s.managed);
    const target=skill?.canDisable?await this.nativeTarget(scope,skill.path):undefined;
    if(!skill||!target)throw new Error('This native Skill cannot be disabled here; bundled or linked sources must be managed at their source');
    const id='disabled-'+randomUUID();entry={id,key:scope.key,name:skill.name,description:skill.description,path:skill.path,target,backup:join(this.root,'disabled-native',id,'package')};
    from=target;to=entry.backup;await mkdir(dirname(to),{recursive:true,mode:0o700});records.push(entry);
   }else{
    const saved=records.find(r=>r.id===input.id&&r.key===scope.key);if(!saved)throw new Error('Unknown native Skill backup in this scope');entry=saved;
    if(entry.target===scope.directory||!inside(scope.directory,entry.target)||!inside(join(this.root,'disabled-native'),entry.backup))throw new Error('Invalid native Skill backup path');
    if(await exists(entry.target)||(await this.list(scope)).skills.some(s=>s.enabled&&s.name===entry.name))throw new Error('A Skill with this name or path is active; disable it before restoring the VM version');
    if(await realpath(dirname(entry.target))!==dirname(entry.target))throw new Error('Native Skill parent changed; inspect it on the VM');
    if(!await exists(entry.backup))throw new Error('Native Skill backup is missing; inspect the VM');
    from=entry.backup;to=entry.target;records.splice(records.indexOf(entry),1);
   }
   await writeFile(join(lock,'recovery.json'),JSON.stringify({action:input.action,from,to,id:entry.id}),{mode:0o600});
   // Atomic relocation preserves all native files and permissions; EXDEV fails without deletion.
   try{await rename(from,to);}catch(e){if((e as NodeJS.ErrnoException).code==='EXDEV')throw new Error('Skill backup is on another filesystem; configure Skill storage on the same filesystem before disabling');throw e;}
   moved=true;await this.saveFile('disabled-native.json',records);committed=true;
   return {ok:true,activation:'Native files were retained. Start a new Agent to apply; existing history is unchanged.'};
  }catch(error){
   if(moved&&!committed)try{await rename(to!,from!);}catch{safeToUnlock=false;throw new Error('Native Skill recovery needs VM inspection; backup and mutation lock were retained');}
   throw error;
  }finally{if(safeToUnlock)await rm(lock,{recursive:true,force:true});}
 }
 async handle(input:any):Promise<unknown>{
  const scope=await this.scope(input);
  if(input.action==='list')return this.list(scope);
  if(input.action==='discover')return this.discover(scope,input);
  if(input.action==='detail'){
   const inventory=await this.list(scope),entry=inventory.skills.find(s=>s.id===input.id);if(!entry)throw new Error('Unknown Skill in this scope');
   const record=(await this.records()).find(r=>r.key===scope.key&&r.id===input.id);
   const disabled=(await this.disabledNative()).find(r=>r.id===input.id&&r.key===scope.key);
   const path=disabled?join(disabled.backup,relative(disabled.target,disabled.path)):record&&!record.enabled?join(record.snapshot,'SKILL.md'):entry.path;
   return {...entry,...await metadata(path)};
  }
  if(!['install','update','enable','disable','disable_native','restore_native'].includes(input.action))throw new Error('Unknown Skill action');
  const next=this.tail.catch(()=>undefined).then(()=>['disable_native','restore_native'].includes(input.action)?this.mutateNative(scope,input):this.mutate(scope,input));this.tail=next;return next;
 }
 private async list(scope:Scope){
  const records=(await this.records()).filter(r=>r.key===scope.key);const skills:SkillView[]=[];
  for(const record of records){
   const path=join(scope.directory,record.name,'SKILL.md');let modified=false,problem:string|undefined;
   try{modified=await this.digest(record.enabled?dirname(path):record.snapshot)!==record.digest;}catch{problem='Installed files are missing or unreadable; inspect on the VM';modified=true;}
   skills.push({id:record.id,name:record.name,description:record.description,path,managed:true,enabled:record.enabled,revision:record.revision,repoUrl:record.repoUrl,ref:record.ref,subdir:record.subdir,modified,...(problem?{problem}:{})});
  }
  for(const entry of (await this.disabledNative()).filter(r=>r.key===scope.key)){
   const present=await exists(entry.backup);skills.push({id:entry.id,name:entry.name,description:entry.description,path:entry.path,managed:false,enabled:false,canRestore:present,...(!present?{problem:'Native Skill backup is missing; inspect the VM'}:{})});
  }
  const seen=new Set<string>();let visited=0;const warnings:string[]=[];
  if(await exists(join(this.root,'mutation.lock')))warnings.push('Skill mutation is active or interrupted; refresh later or inspect the VM recovery record');
  const scan=async(directory:string,depth=0):Promise<void>=>{
   if(depth>5||++visited>500){warnings.push('Inventory limit reached; additional Skills may exist on the VM');return;}
   try{
    const actual=await realpath(directory);if(seen.has(actual))return;seen.add(actual);
    const direct=(await stat(directory)).isFile();
    const file=direct?directory:join(directory,'SKILL.md');
    if(direct||await exists(file)){
     if(skills.some(s=>s.enabled&&s.path===file))return;
     try{const m=await metadata(file);skills.push({id:'external-'+hash(file).slice(0,24),name:m.name,description:m.description,path:file,managed:false,enabled:true,canDisable:Boolean(await this.nativeTarget(scope,file))});}catch{warnings.push('Invalid Skill: '+directory);}return;
    }
    for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;if(entry.isDirectory()||entry.isSymbolicLink()||scope.engine==='pi'&&depth===0&&entry.name.endsWith('.md'))await scan(join(directory,entry.name),depth+1);}
   }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')warnings.push('Cannot inspect Skills directory: '+directory);}
  };
  await scan(scope.directory);
  if(scope.engine==='pi'&&scope.scope==='user')for(const directory of this.options.bundledPiSkills??[])await scan(directory);
  return {engine:scope.engine,scope:scope.scope,directory:scope.directory,skills,warnings:[...new Set(warnings)],activation:'Native discovery on the next Agent start; reload an idle task to apply. Already loaded instructions remain in conversation history.'};
 }
 private async digest(directory:string):Promise<string>{
  const result=createHash('sha256');let size=0,count=0;
  const walk=async(path:string):Promise<void>=>{
   const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Skill package contains a symlink: '+(relative(directory,path)||'.'));
   if(info.isDirectory()){for(const name of (await readdir(path)).sort()){if(name==='.git')continue;await walk(join(path,name));}return;}
   if(!info.isFile())throw new Error('Skill package contains a special file');
   if(++count>MAX_FILES||(size+=info.size)>MAX_PACKAGE)throw new Error('Skill package exceeds 500 files or 10 MB');
   result.update(relative(directory,path)).update('\0').update(String(info.mode&0o777)).update('\0').update(await readFile(path));
  };await walk(directory);return result.digest('hex');
 }
 private sourceUrl(value:unknown){
  const source=text(value);if(this.options.allowLocalSources&&isAbsolute(source))return source;
  let url:URL;try{url=new URL(source);}catch{throw new Error('Use a credential-free HTTP(S) or ssh:// Git clone URL');}
  if(!['http:','https:','ssh:'].includes(url.protocol)||url.password||(url.protocol!=='ssh:'&&url.username)||url.search||url.hash)throw new Error('Git source must not contain credentials, query strings or fragments');return source;
 }
 private async git(cwd:string,args:string[],url:string){
  const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -oBatchMode=yes -oStrictHostKeyChecking=yes'};
  const forge=this.options.gitea;
  if(forge&&new URL(forge.url).origin===(()=>{try{return new URL(url).origin;}catch{return '';}})()){
   const origin=new URL(forge.url).origin;Object.assign(env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${origin}/.extraHeader`,GIT_CONFIG_VALUE_0:'Authorization: Basic '+Buffer.from(forge.owner+':'+forge.token).toString('base64')});
  }
  try{return (await exec('git',['-c','core.hooksPath=/dev/null','-c','http.followRedirects=false','-c',`protocol.file.allow=${this.options.allowLocalSources?'always':'never'}`,...args],{cwd,env,timeout:45000,maxBuffer:1024*1024})).stdout.trim();}
  catch{throw new Error('Git source could not be fetched. Check the URL, ref and VM Git credentials; installed Skill was retained.');}
 }
 private source(input:any){
  const source={repoUrl:this.sourceUrl(input.repoUrl),ref:text(input.ref,'HEAD')||'HEAD',subdir:text(input.subdir,'.')||'.'};
  if(source.ref.startsWith('-')||isAbsolute(source.subdir)||source.subdir.split(/[\\/]/).includes('..'))throw new Error('Invalid Skill ref or subdirectory');
  return source;
 }
 private async checkout(source:{repoUrl:string;ref:string;subdir:string}){
  const temporary=await mkdtemp(join(tmpdir(),'coffee-skill-'));
  try{
   await this.git(temporary,['init','--quiet'],source.repoUrl);await this.git(temporary,['fetch','--quiet','--depth=1','--',source.repoUrl,source.ref],source.repoUrl);
   const revision=await this.git(temporary,['rev-parse','FETCH_HEAD'],source.repoUrl);
   await this.git(temporary,['checkout','--quiet','--detach',revision],source.repoUrl);
   const directory=resolve(temporary,source.subdir);if(!inside(temporary,directory)||!inside(temporary,await realpath(directory)))throw new Error('Skill subdirectory is outside the repository');
   if((await lstat(directory)).isSymbolicLink())throw new Error('Select a real Skill directory, not a symlink');
   return {temporary,directory,revision};
  }catch(e){await rm(temporary,{recursive:true,force:true});throw e;}
 }
 private async discover(scope:Scope,input:any){
  const source=this.source(input),checkout=await this.checkout(source);
  const skills:Array<{name:string;description:string;subdir:string;installed:boolean;problem?:string}>=[];
  const warnings:string[]=[];let visited=0;
  try{
   const inventory=await this.list(scope);
   const walk=async(directory:string,depth:number):Promise<void>=>{
    if(++visited>5000 || depth>12)throw new Error('Skill discovery limit reached; select a narrower subdirectory');
    const info=await lstat(directory);if(info.isSymbolicLink()||!info.isDirectory())return;
    const file=join(directory,'SKILL.md');
    if(await exists(file)){
     const subdir=relative(checkout.temporary,directory).split(sep).join('/')||'.';
     try{
      const fileInfo=await lstat(file);if(!fileInfo.isFile()||fileInfo.isSymbolicLink())throw new Error('SKILL.md must be a regular file');
      const m=await metadata(file);let problem:string|undefined;
      try{await this.digest(directory);}catch(e){problem=e instanceof Error?e.message:'Invalid Skill package';}
      skills.push({name:m.name,description:m.description,subdir,installed:inventory.skills.some(s=>s.name===m.name&&(s.enabled||s.managed))||await exists(join(scope.directory,m.name)),...(problem?{problem}:{})});
     }catch{warnings.push('Invalid SKILL.md: '+subdir);}
     if(skills.length>200)throw new Error('More than 200 Skills; select a narrower subdirectory');
     return;
    }
    for(const name of (await readdir(directory)).sort()){if(name!=='.git')await walk(join(directory,name),depth+1);}
   };
   await walk(checkout.directory,0);
   return {...source,revision:checkout.revision,skills,warnings};
  }finally{await rm(checkout.temporary,{recursive:true,force:true});}
 }
 private async fetch(source:{repoUrl:string;ref:string;subdir:string}){
  const checkout=await this.checkout(source);
  try{
   if(!await exists(join(checkout.directory,'SKILL.md')))throw new Error('No SKILL.md in the selected directory. Read the repository Skill list and select packages, or specify a Skill subdirectory.');
   await this.digest(checkout.directory);const m=await metadata(join(checkout.directory,'SKILL.md'));
   return {...checkout,...m};
  }catch(e){await rm(checkout.temporary,{recursive:true,force:true});throw e;}
 }
 private async mutate(scope:Scope,input:any){
  await mkdir(this.root,{recursive:true,mode:0o700});const lock=join(this.root,'mutation.lock');
  try{await mkdir(lock);}catch{throw new Error('Skill operation in progress or interrupted; inspect the VM Skill registry before retrying');}
  let fetched:Awaited<ReturnType<SkillManager['fetch']>>|undefined;
  let backup:string|undefined,target:string|undefined,published=false,committed=false,safeToUnlock=true;
  try{
   const records=await this.records();let record=records.find(r=>r.key===scope.key&&r.id===input.id);
   if(input.action!=='install'&&!record)throw new Error('Only Skills installed through Web can be changed here');
   if(record){
    const current=record.enabled?join(scope.directory,record.name):record.snapshot;
    if(await this.digest(current)!==record.digest)throw new Error('Skill has local edits. Preserve or reconcile them on the VM before updating or toggling.');
   }
   if(input.action==='install'||input.action==='update'){
    const source=this.source(record??input);
    const expectedRevision=text(input.expectedRevision);
    if(expectedRevision&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedRevision))throw new Error('Invalid preview revision');
    fetched=await this.fetch(source);
    if(expectedRevision&&fetched.revision!==expectedRevision)throw new Error('Skill source changed since preview; read the repository list again before installing.');
    if(record&&fetched.name!==record.name)throw new Error('Updated Skill changed its name; install it separately');
    if(!record&&((await this.list(scope)).skills.some(s=>s.name===fetched!.name&&(s.enabled||s.managed))||await exists(join(scope.directory,fetched.name))))throw new Error('A Skill with this name already exists; it was not overwritten');
    const snapshot=join(this.root,'versions',randomUUID());await mkdir(dirname(snapshot),{recursive:true,mode:0o700});
    await cp(fetched.directory,snapshot,{recursive:true,filter:path=>basename(path)!=='.git'});
    record={id:record?.id??randomUUID(),key:scope.key,name:fetched.name,description:fetched.description,...source,revision:fetched.revision,snapshot,digest:await this.digest(snapshot),enabled:record?.enabled??true,updatedAt:new Date().toISOString()};
   }else record={...record!,enabled:input.action==='enable',updatedAt:new Date().toISOString()};
   if(record.enabled&&(await this.list(scope)).skills.some(s=>s.enabled&&s.name===record!.name&&s.id!==record!.id))throw new Error('Another active Skill has this name; disable it first');
   target=join(scope.directory,record.name);
   const prior=records.find(r=>r.id===record!.id);
   if(prior?.enabled||record.enabled){
    // Never replace a symlinked native directory with platform-managed files.
    await mkdir(scope.directory,{recursive:true});if(await realpath(scope.directory)!==scope.directory)throw new Error('Skill directory is symlinked; manage it directly on the VM');
    if(await exists(target)){
     if(!prior?.enabled)throw new Error('Native Skill path is occupied; it was not overwritten');
     backup=join(this.root,'retained',randomUUID());await mkdir(dirname(backup),{recursive:true});
     await writeFile(join(lock,'recovery.json'),JSON.stringify({target,backup,recordId:record.id}));
     // cp supports project directories on a different filesystem; old files are retained.
     await cp(target,backup,{recursive:true});await rm(target,{recursive:true});
    }
    if(record.enabled){
     const staging=join(scope.directory,'.coffee-'+randomUUID());
     try{await cp(record.snapshot,staging,{recursive:true});await rename(staging,target);published=true;}finally{await rm(staging,{recursive:true,force:true});}
    }
   }
   const index=records.findIndex(r=>r.id===record!.id);if(index<0)records.push(record);else records[index]=record;
   await this.save(records);committed=true;
   return {ok:true,skill:(await this.list(scope)).skills.find(s=>s.id===record!.id),activation:'Start a new task or reload an idle Agent to apply; running tasks were not stopped.'};
  }catch(e){
   try{if(!committed&&target){if(published)await rm(target,{recursive:true,force:true});if(backup&&await exists(backup))await cp(backup,target,{recursive:true});}}catch{safeToUnlock=false;throw new Error('Skill recovery needs VM inspection; retained files and mutation lock were preserved');}
   throw e;
  }finally{if(fetched)await rm(fetched.temporary,{recursive:true,force:true});if(safeToUnlock)await rm(lock,{recursive:true,force:true});}
 }
}
