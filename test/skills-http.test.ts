import {loadSkills} from '@earendil-works/pi-coding-agent';
import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
const exec=promisify(execFile);let server:HostServer|undefined;let root='';
afterEach(async()=>{await server?.close();server=undefined;if(root)await rm(root,{recursive:true,force:true});});
async function setup(){
 root=await mkdtemp(join(tmpdir(),'coffee-skills-'));const source=join(root,'source');await mkdir(join(source,'skills','example'),{recursive:true});
 await cp('test/fixtures/skills/example',join(source,'skills/example'),{recursive:true});
 const git=(...args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});await git('init','-b','main');await git('add','.');await git('commit','-m','skill');
 const workspaces=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});
 const start=async()=>{server=new HostServer({port:0,token:'skills-test',factory:{list:async()=>[],delete:async()=>false,create:async()=>({getState:async()=>({isStreaming:false,messageCount:0}),getHistory:async()=>({entries:[],leafId:null}),onEvent:()=>()=>{},stop:async()=>{},backgroundState:async()=>({known:true,active:0}),prompt:async()=>{throw new Error('No model calls');}} as any)},workspaces,skills:{home:join(root,'home'),root:join(root,'managed'),allowLocalSources:true}});
 await server.start();};await start();const url=`http://127.0.0.1:${server.address().port}/api/skills`;
 const call=async(body:any,token='skills-test')=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/skills`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {source,git,call,workspaces,url,start};
}
it('installs a Git Skill into only the selected native engine, with source revision and supporting files',async()=>{
 const {source,call,url}=await setup();expect((await fetch(url)).status).toBe(401);
 const installed=await call({action:'install',engine:'pi',scope:'user',repoUrl:source,ref:'main',subdir:'skills/example'});expect(installed.status).toBe(200);
 const list=await call({action:'list',engine:'pi',scope:'user'});expect(list.body.skills).toHaveLength(1);expect(list.body.skills[0]).toMatchObject({name:'example',enabled:true,managed:true,revision:expect.stringMatching(/^[a-f0-9]{40}$/)});
 expect(await readFile(join(root,'home/.pi/agent/skills/example/reference.txt'),'utf8')).toBe('original');
 expect(loadSkills({cwd:root,skillPaths:[],includeDefaults:true,agentDir:join(root,'home/.pi/agent')}).skills.map(s=>s.name)).toContain('example');
 expect((await call({action:'list',engine:'claude',scope:'user'})).body.skills).toEqual([]);
 expect((await call({action:'detail',engine:'pi',scope:'user',id:list.body.skills[0].id})).body.content).toContain('Use the reference.');
});

it('updates pinned content, disables/re-enables reversibly, retains old versions and survives Host restart',async()=>{
 const {source,git,call,start}=await setup();const scope={engine:'pi',scope:'user'};
 const first=await call({...scope,action:'install',repoUrl:source,ref:'main',subdir:'skills/example'});expect(first.status,JSON.stringify(first.body)).toBe(200);const id=first.body.skill.id;
 await writeFile(join(source,'skills/example/reference.txt'),'updated');await git('add','.');await git('commit','-m','update');
 const update=await call({...scope,action:'update',id});expect(update.status).toBe(200);expect(update.body.skill.revision).not.toBe(first.body.skill.revision);
 expect(await readFile(join(root,'home/.pi/agent/skills/example/reference.txt'),'utf8')).toBe('updated');
 expect((await call({...scope,action:'disable',id})).status).toBe(200);await expect(readFile(join(root,'home/.pi/agent/skills/example/SKILL.md'))).rejects.toMatchObject({code:'ENOENT'});
 expect((await call({...scope,action:'detail',id})).body.content).toContain('Use the reference.');
 expect((await call({...scope,action:'enable',id})).body.skill.enabled).toBe(true);
 const failure=await call({...scope,action:'install',repoUrl:source,ref:'missing',subdir:'skills/example'});expect(failure.status).toBe(409);expect(await readFile(join(root,'home/.pi/agent/skills/example/reference.txt'),'utf8')).toBe('updated');
 await writeFile(join(root,'home/.pi/agent/skills/example/reference.txt'),'local edits');expect((await call({...scope,action:'update',id})).body.error).toContain('local edits');
 await server!.close();await start();
 expect((await call({...scope,action:'list'})).body.skills[0]).toMatchObject({id,modified:true,enabled:true});
});

it('uses independent Work checkout native directories, preserves unmanaged skills and rejects invalid package paths',async()=>{
 const {source,call,workspaces}=await setup();const project=await workspaces.registerProject('skills-fixture',source);const task=await workspaces.createConversation(project.id,undefined,undefined,'codex');
 const scope={engine:'codex',scope:'project',conversationId:task.id};const install=await call({...scope,action:'install',repoUrl:source,ref:'main',subdir:'skills/example'});expect(install.status,JSON.stringify(install.body)).toBe(200);
 expect(await readFile(join(task.cwd,'.agents/skills/example/reference.txt'),'utf8')).toBe('original');
 expect((await call({...scope,engine:'pi',action:'list'})).status).toBe(409);
 expect((await call({engine:'pi',scope:'user',action:'install',repoUrl:source,subdir:'../'})).status).toBe(409);
 await mkdir(join(root,'home/.claude/skills/manual'),{recursive:true});await writeFile(join(root,'home/.claude/skills/manual/SKILL.md'),'---\nname: manual\ndescription: Keep user content.\n---\nOriginal');
 const manual=(await call({engine:'claude',scope:'user',action:'list'})).body.skills[0];expect(manual.managed).toBe(false);
 expect((await call({engine:'claude',scope:'user',action:'disable',id:manual.id})).status).toBe(409);
 expect((await call({engine:'pi',scope:'project',conversationId:(await workspaces.createChatConversation()).id,action:'list'})).status).toBe(409);
});

it('reloads only a known matching idle Task and does not create tasks or model calls',async()=>{
 const {call,workspaces}=await setup();
 const task=await workspaces.createChatConversation();expect((await call({action:'reload',engine:'pi',scope:'user',conversationId:task.id})).status).toBe(200);
 expect((await call({action:'reload',engine:'codex',scope:'user',conversationId:task.id})).status).toBe(409);
 expect((await call({action:'reload',engine:'pi',scope:'user',conversationId:'unknown'})).status).toBe(409);
});

it('refuses collisions, symlink packages, credential URLs and interrupted writes without replacing installed files',async()=>{
 const {source,git,call}=await setup();const scope={engine:'pi',scope:'user'};
 const first=await call({...scope,action:'install',repoUrl:source,ref:'main',subdir:'skills/example'});expect(first.status).toBe(200);
 expect((await call({...scope,action:'install',repoUrl:source,ref:'main',subdir:'skills/example'})).body.error).toContain('already exists');
 expect((await call({...scope,action:'install',repoUrl:'https://user:secret@example.com/skills.git'})).status).toBe(409);
 const {symlink}=await import('node:fs/promises');await symlink('/etc/passwd',join(source,'skills/example/link'));await git('add','.');await git('commit','-m','symlink');
 const update=await call({...scope,action:'update',id:first.body.skill.id});expect(update.status).toBe(409);expect((await call({...scope,action:'list'})).body.skills[0].revision).toBe(first.body.skill.revision);
 await mkdir(join(root,'managed/mutation.lock'));expect((await call({...scope,action:'disable',id:first.body.skill.id})).status).toBe(409);
 expect((await call({...scope,action:'list'})).body.warnings.join(' ')).toContain('interrupted');
 expect(loadSkills({cwd:root,skillPaths:[],includeDefaults:true,agentDir:join(root,'home/.pi/agent')}).skills.map(s=>s.name)).toContain('example');
});

it('reviews and checkpoints project Pi Skills while keeping Pi credentials outside the code surface',async()=>{
 const {source,call,workspaces}=await setup();const project=await workspaces.registerProject('pi-skills-code',source);const task=await workspaces.createConversation(project.id);
 await call({action:'install',engine:'pi',scope:'project',conversationId:task.id,repoUrl:source,ref:'main',subdir:'skills/example'});
 await writeFile(join(task.cwd,'.pi/auth.json'),'synthetic-private');
 const post=async(action:string,extra={})=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer skills-test','content-type':'application/json'},body:JSON.stringify({action,id:task.id,...extra})});return {status:r.status,body:await r.json()};};
 const review=await post('changes');expect(review.body.files.map((f:any)=>f.path)).toContain('.pi/skills/example/SKILL.md');expect(review.body.files.map((f:any)=>f.path)).not.toContain('.pi/auth.json');
 expect(await readFile(await workspaces.file(task.id,'.pi/skills/example/reference.txt'),'utf8')).toBe('original');
 await expect(workspaces.file(task.id,'.pi/auth.json')).rejects.toThrow();
 await exec('git',['config','user.name','Skill Test'],{cwd:task.cwd});await exec('git',['config','user.email','skill@test.local'],{cwd:task.cwd});
 const checkpoint=await post('checkpoint',{paths:['.pi/skills/example/SKILL.md','.pi/skills/example/reference.txt'],message:'Share project Skill'});expect(checkpoint.status,JSON.stringify(checkpoint.body)).toBe(200);
 expect((await post('checkpoint',{paths:['.pi/auth.json'],message:'must reject'})).status).toBe(409);
});

it('discovers a collection despite unrelated root links, then installs only the selected package at the previewed revision',async()=>{
 const {source,git,call}=await setup();const scope={engine:'pi',scope:'user'};
 const {symlink}=await import('node:fs/promises');
 await writeFile(join(source,'CLAUDE.md'),'Repository instructions');await symlink('CLAUDE.md',join(source,'AGENTS.md'));
 await mkdir(join(source,'skills/second'));await writeFile(join(source,'skills/second/SKILL.md'),'---\nname: second\ndescription: Second skill.\n---\nBody');
 await symlink('/etc',join(source,'external'));await git('add','.');await git('commit','-m','collection');
 const result=await call({...scope,action:'discover',repoUrl:source});
 expect(result.status,JSON.stringify(result.body)).toBe(200);
 expect(result.body.skills.map((s:any)=>[s.name,s.subdir])).toEqual([['example','skills/example'],['second','skills/second']]);
 expect((await call({...scope,action:'list'})).body.skills).toEqual([]);
 const installed=await call({...scope,action:'install',repoUrl:source,subdir:'skills/example',expectedRevision:result.body.revision});
 expect(installed.status).toBe(200);expect((await call({...scope,action:'list'})).body.skills.map((s:any)=>s.name)).toEqual(['example']);
 const rootInstall=await call({...scope,action:'install',repoUrl:source});expect(rootInstall.body.error).toContain('SKILL.md');expect(rootInstall.body.error).not.toContain('may not contain symlinks');
 await writeFile(join(source,'skills/second/new.txt'),'changed since preview');await git('add','.');await git('commit','-m','change');
 const changed=await call({...scope,action:'install',repoUrl:source,subdir:'skills/second',expectedRevision:result.body.revision});
 expect(changed.status).toBe(409);expect(changed.body.error).toContain('changed');
 expect((await call({...scope,action:'list'})).body.skills).toHaveLength(1);
 const fresh=await call({...scope,action:'discover',repoUrl:source});expect(fresh.body.skills[0].installed).toBe(true);
});

it('does not follow linked Skill metadata or install linked resources discovered inside a package',async()=>{
 const {source,git,call}=await setup();const {symlink}=await import('node:fs/promises');
 await symlink('/etc/passwd',join(source,'skills/example/reference-link'));
 await mkdir(join(source,'skills/linked'));await symlink('../../skills/example/SKILL.md',join(source,'skills/linked/SKILL.md'));
 await git('add','.');await git('commit','-m','linked packages');
 const scope={engine:'pi',scope:'user'};
 const denied=await call({...scope,action:'discover',repoUrl:source},'invalid');expect(denied.status).toBe(401);
 const preview=await call({...scope,action:'discover',repoUrl:source});expect(preview.status).toBe(200);
 expect(preview.body.skills).toHaveLength(1);expect(preview.body.skills[0].problem).toContain('reference-link');
 expect(preview.body.warnings).toContain('Invalid SKILL.md: skills/linked');
 expect((await call({...scope,action:'install',repoUrl:source,subdir:'skills/example'})).status).toBe(409);
 expect((await call({...scope,action:'list'})).body.skills).toEqual([]);
});
