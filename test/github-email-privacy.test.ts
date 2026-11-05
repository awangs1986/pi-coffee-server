import {afterEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PersonalBackup} from '../src/host/personal-backup.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces,type GitHubForge} from '../src/host/workspaces.js';
const exec=promisify(execFile);
const git=async(cwd:string,args:string[]) => (await exec('/usr/bin/git',['-c','user.name=Alice','-c','user.email=private@example.test',...args],{cwd})).stdout.trim();
let root:string,host:HostServer;
afterEach(async()=>{await host?.close();if(root)await rm(root,{recursive:true,force:true});});
async function fixture(ordinary=false,empty=false){
 root=await mkdtemp(join(tmpdir(),'coffee-email-'));const source=join(root,'seed'),remote=join(root,'remote.git');await mkdir(source);
 await git(source,['init','-b','main']);await writeFile(join(source,'README.md'),'unchanged source\n');await git(source,['add','.']);await git(source,['commit','-m','Original description']);
 await git(root,['clone','--bare',source,remote]);const original=await git(remote,['rev-parse','main']);
 await writeFile(join(remote,'hooks/pre-receive'),'#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in refs/heads/coffee/*)\n    email=$(git show -s --format=%ae "$new")\n    case "$email" in *@users.noreply.github.com) ;; *) echo "remote: error: GH007: Your push would publish a private email address." >&2; exit 1;; esac;;\n  esac\ndone\n',{mode:0o700});
 if(empty){await git(remote,['update-ref','-d','refs/heads/main']);await writeFile(join(remote,'hooks/pre-receive'),'#!/bin/sh\nwhile read old new ref; do\ncase "$(git show -s --format=%ae "$new")" in *@users.noreply.github.com) ;; *) echo "GH007: Your push would publish a private email address." >&2; exit 1;; esac\ndone\n',{mode:0o700});}
 const github:GitHubForge={webHost:'github.com',listRepositories:async()=>[],repository:async()=>({id:'1',fullName:'owner/project',private:true,archived:false,defaultBranch:'main',cloneUrl:remote,webUrl:'https://github.com/owner/project',canPush:true}),createPullRequest:async()=>{throw Error('No PR expected');}};
 const backup=ordinary?await PersonalBackup.open(join(root,'backup')):undefined;
 const workspaces=new Workspaces(join(root,'work'),{ownerId:'alice',github,gitCommandCustody:backup?.custody});if(backup)workspaces.setBackupWriterFence(backup.fence);
 const factory={list:async()=>[],delete:async()=>false,create:async()=>({getState:async()=>({isStreaming:false,messageCount:0}),getHistory:async()=>({entries:[],leafId:null}),onEvent:()=>()=>{},stop:async()=>{},abort:async()=>{},backgroundState:async()=>({known:true,active:0}),prompt:async()=>{throw Error('No model calls expected');}} as any)};
 host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
 const call=async(body:object)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const registered=await call({action:'github_project',repository:'owner/project'});expect(registered.status).toBe(200);
 return {remote,original,workspaces,call,projectId:registered.body.id};
}
it.each([false,true])('creates a GitHub task despite GH007, preserving published history and confirming an anonymous task head (custody=%s)',async ordinary=>{
 const f=await fixture(ordinary);const result=await f.call({action:'conversation',projectId:f.projectId,id:'email-task',workspaceKind:'project',engine:'pi'});
 expect(result.status,JSON.stringify(result.body)).toBe(200);
 expect(result.body.creationState).toBe('ready');
 const published=await git(f.remote,['rev-parse','refs/heads/coffee/alice/email-task']);
 expect(published).not.toBe(f.original);expect(result.body.lastRemoteSha).toBe(published);
 expect(await git(f.remote,['rev-parse','main'])).toBe(f.original);
 expect(await git(f.remote,['rev-parse',published+'^'])).toBe(f.original);
 expect(await git(f.remote,['diff',f.original,published])).toBe('');
 expect(await git(f.remote,['show','-s','--format=%ae%n%ce',published])).toBe('pi-coffee@users.noreply.github.com\npi-coffee@users.noreply.github.com');
 expect((await f.call({action:'conversation',projectId:f.projectId,id:'email-task',workspaceKind:'project',engine:'pi'})).body.lastRemoteSha).toBe(published);
},20000);
it('anonymizes unpublished checkpoints without changing their content, messages, dates or uncommitted files',async()=>{
 const f=await fixture();const created=await f.call({action:'conversation',projectId:f.projectId,id:'checkpoints',workspaceKind:'project',engine:'pi'});expect(created.status).toBe(200);const cwd=created.body.cwd,base=created.body.lastRemoteSha;
 await writeFile(join(cwd,'a.bin'),Buffer.from([0,255,1,2]));await git(cwd,['add','a.bin']);await git(cwd,['commit','-m','First message\n\n中文说明']);
 const first=await git(cwd,['rev-parse','HEAD']);await writeFile(join(cwd,'README.md'),'new code\n');await git(cwd,['add','README.md']);await git(cwd,['commit','-m','Second message']);const original=await git(cwd,['rev-parse','HEAD']);
 const descriptions=await git(cwd,['log','--reverse','--format=%B%x00%at%x00%ct',base+'..HEAD']);
 await writeFile(join(cwd,'README.md'),'unsaved work\n');await writeFile(join(cwd,'draft.txt'),'private draft');
 const beforeStatus=await git(cwd,['status','--porcelain']);const beforeSync=await f.call({action:'status',id:'checkpoints'});expect(beforeSync.body).toMatchObject({state:'ahead',localSha:original,remoteSha:base});const result=await f.call({action:'sync',id:'checkpoints'});expect(result.status,JSON.stringify(result.body)).toBe(200);
 expect(result.body.localSha).toBe(result.body.remoteSha);expect(result.body.localSha).not.toBe(original);
 expect(await git(cwd,['diff',original,result.body.localSha])).toBe('');expect(await git(cwd,['status','--porcelain'])).toBe(beforeStatus);
 expect(await git(cwd,['log','--reverse','--format=%B%x00%at%x00%ct',base+'..HEAD'])).toBe(descriptions);
 expect(await git(cwd,['log','--format=%ae%n%ce',base+'..HEAD'])).not.toContain('private@example.test');
 expect(await git(cwd,['rev-parse','refs/coffee/email-privacy/'+original])).toBe(original);
 expect(await git(cwd,['cat-file','-t',first])).toBe('commit');expect(await git(f.remote,['rev-parse','main'])).toBe(f.original);
},20000);
it('retains a repaired checkout when retry is rejected, then resumes the same creation ID',async()=>{
 const f=await fixture();const hook=join(f.remote,'hooks/pre-receive');
 await writeFile(hook,'#!/bin/sh\nwhile read old new ref; do\ncase "$(git show -s --format=%ae "$new")" in *@users.noreply.github.com) echo "GH006: Protected branch" >&2;; *) echo "GH007: Your push would publish a private email address." >&2;; esac\nexit 1\ndone\n',{mode:0o700});
 const request={action:'conversation',projectId:f.projectId,id:'retry-task',workspaceKind:'project',engine:'pi'};
 const failed=await f.call(request);expect(failed.status).toBe(409);expect(failed.body.error).toContain('GH006');
 const task=(await f.workspaces.lookup('retry-task'))!;const head=await git(task.cwd,['rev-parse','HEAD']);expect(head).not.toBe(f.original);expect(task.gitEmailRepair?.head).toBe(head);
 await writeFile(hook,'#!/bin/sh\nexit 0\n',{mode:0o700});const retried=await f.call(request);expect(retried.status,JSON.stringify(retried.body)).toBe(200);expect(retried.body.lastRemoteSha).toBe(head);expect(retried.body.startSha).toBe(f.original);
 expect((await f.workspaces.list()).conversations).toHaveLength(1);
},20000);
it('does not anonymize or retry a non-email rejection',async()=>{
 const f=await fixture();await writeFile(join(f.remote,'hooks/pre-receive'),'#!/bin/sh\necho "Permission denied" >&2\nexit 1\n',{mode:0o700});
 const result=await f.call({action:'conversation',projectId:f.projectId,id:'denied',workspaceKind:'project',engine:'pi'});expect(result.status).toBe(409);expect(result.body.error).toContain('Permission denied');
 const task=(await f.workspaces.lookup('denied'))!;expect(await git(task.cwd,['rev-parse','HEAD'])).toBe(f.original);expect(await git(task.cwd,['for-each-ref','--format=%(refname)','refs/coffee/email-privacy/'])).toBe('');
},20000);

it('initializes an empty GitHub repository with anonymous metadata before its first push',async()=>{
 const f=await fixture(false,true);const result=await f.call({action:'conversation',projectId:f.projectId,id:'empty-task',workspaceKind:'project',engine:'pi'});
 expect(result.status,JSON.stringify(result.body)).toBe(200);expect(await git(f.remote,['show','-s','--format=%ae','main'])).toBe('pi-coffee@users.noreply.github.com');
 expect(await git(f.remote,['rev-parse','main'])).toBe(result.body.lastRemoteSha);
},20000);
it('preserves merge parents when repairing unpublished history',async()=>{
 const f=await fixture();const created=await f.call({action:'conversation',projectId:f.projectId,id:'merged',workspaceKind:'project',engine:'pi'});expect(created.status).toBe(200);const cwd=created.body.cwd,base=created.body.lastRemoteSha;
 await git(cwd,['checkout','-b','side']);await writeFile(join(cwd,'side'),'side');await git(cwd,['add','side']);await git(cwd,['commit','-m','Side']);
 await git(cwd,['checkout','coffee/alice/merged']);await writeFile(join(cwd,'trunk'),'trunk');await git(cwd,['add','trunk']);await git(cwd,['commit','-m','Trunk']);await git(cwd,['merge','--no-ff','side','-m','Merge work']);const old=await git(cwd,['rev-parse','HEAD']);
 const result=await f.call({action:'sync',id:'merged'});expect(result.status,JSON.stringify(result.body)).toBe(200);
 expect((await git(cwd,['show','-s','--format=%P','HEAD'])).split(' ')).toHaveLength(2);expect(await git(cwd,['rev-list','--count',base+'..HEAD'])).toBe('3');expect(await git(cwd,['diff',old,'HEAD'])).toBe('');
 expect(await git(cwd,['log','--format=%ae%n%ce',base+'..HEAD'])).not.toContain('private@example.test');
},20000);
it('retains signed unpublished commits and requires re-signing instead of dropping their signatures',async()=>{
 const f=await fixture();const created=await f.call({action:'conversation',projectId:f.projectId,id:'signed',workspaceKind:'project',engine:'pi'});expect(created.status).toBe(200);const cwd=created.body.cwd;
 await writeFile(join(cwd,'signed'),'signed');await git(cwd,['add','signed']);await git(cwd,['commit','-m','Signed message']);const raw=await git(cwd,['cat-file','commit','HEAD']);
 const signed=await new Promise<string>((resolve,reject)=>{const p=execFile('/usr/bin/git',['hash-object','-w','-t','commit','--stdin'],{cwd},(e,out)=>e?reject(e):resolve(out.trim()));p.stdin!.end(raw.replace('\n\n','\ngpgsig -----BEGIN PGP SIGNATURE-----\n fixture\n -----END PGP SIGNATURE-----\n\n')+'\n');});await git(cwd,['update-ref','HEAD',signed]);
 const result=await f.call({action:'sync',id:'signed'});expect(result.status).toBe(409);expect(result.body.error).toContain('Signed unpublished commits');expect(await git(cwd,['rev-parse','HEAD'])).toBe(signed);expect(await git(cwd,['cat-file','commit','HEAD'])).toContain('gpgsig');
 expect(await git(f.remote,['rev-parse',created.body.branch])).toBe(created.body.lastRemoteSha);
},20000);
it('continues a published private-email tip without rewriting the source branch',async()=>{
 const f=await fixture();const result=await f.call({action:'continue',projectId:f.projectId,sourceBranch:'main',sourceSha:f.original,id:'continued',engine:'pi'});
 expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.startSha).toBe(f.original);expect(result.body.lastRemoteSha).not.toBe(f.original);expect(await git(f.remote,['rev-parse','main'])).toBe(f.original);expect(await git(f.remote,['rev-parse',result.body.branch])).toBe(result.body.lastRemoteSha);
},20000);
