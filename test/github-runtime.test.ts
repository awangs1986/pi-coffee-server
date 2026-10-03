import {it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {GitHubAccounts} from '../src/host/github-accounts.js';
const exec=promisify(execFile);let root='';afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});});
it('uses independent Git and gh identities concurrently, denies unbound calls and observes disconnection without restarting agents',async()=>{
 root=await mkdtemp(join(tmpdir(),'coffee-git-auth-'));const manager=new GitHubAccounts(join(root,'alice'));
 await mkdir(manager.root,{recursive:true});await writeFile(manager.file,JSON.stringify({version:1,accounts:[{id:'one',githubId:'1',login:'personal',token:'private-one'},{id:'two',githubId:'2',login:'work',token:'private-two'}]}));
 const nativeGh=join(root,'native-gh');await writeFile(nativeGh,'#!/bin/sh\nprintf "%s" "$GH_TOKEN"\n',{mode:0o700});
 const first=await manager.environment('one',nativeGh),second=await manager.environment('two',nativeGh),denied=await manager.environment(undefined,nativeGh);
 const gh=async(env:Record<string,string>)=>exec('gh',['api','user'],{env:{...process.env,...env}}).then(r=>r.stdout);
 expect(await Promise.all([gh(first),gh(second)])).toEqual(['private-one','private-two']);
 expect((await exec('/bin/bash',['-lc','command -v gh'],{env:{...process.env,...first}})).stdout.trim()).toBe(join(manager.root,'tools','one','gh'));
 expect((await exec('/bin/bash',['-lc','gh api user'],{env:{...process.env,...second}})).stdout).toBe('private-two');
 for(const args of [['auth','status','-t'],['auth','status','--show-token=true'],['-R','org/repo','auth','status','-t']])await expect(exec('gh',args,{env:{...process.env,...first}})).rejects.toThrow();
 await expect(gh(denied)).rejects.toThrow();
 // Real Git credential interface must suppress a hostile ambient fallback helper.
 const gitConfig=join(root,'ambient-config');await writeFile(gitConfig,'[credential]\n helper = "!f() { echo username=wrong; echo password=ambient-secret; }; f"\n');
 const credential=(env:Record<string,string>)=>new Promise<string>((resolve,reject)=>{const p=execFile('git',['credential','fill'],{env:{...process.env,GIT_CONFIG_GLOBAL:gitConfig,...env}},(e,out)=>e?reject(e):resolve(out));p.stdin!.end('protocol=https\nhost=github.com\n\n');});
 expect(await credential(first)).toContain('password=private-one');expect(await credential(second)).toContain('password=private-two');await expect(credential(denied)).rejects.toThrow();
 await manager.handle({action:'delete',id:'one'});await expect(gh(first)).rejects.toThrow();await expect(credential(first)).rejects.toThrow();expect(await gh(second)).toBe('private-two');
});
