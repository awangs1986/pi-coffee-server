import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {GitHubAccounts} from '../src/host/github-accounts.js';
const exec=promisify(execFile);let root:string;
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});});
it('repairs a managed native Git task push with the selected account anonymous identity',async()=>{
 root=await mkdtemp(join(tmpdir(),'coffee-email-native-'));const cwd=join(root,'work'),remote=join(root,'remote.git');await mkdir(cwd);
 const git=async(args:string[],at=cwd)=>(await exec('/usr/bin/git',['-c','user.name=Alice','-c','user.email=private@example.test',...args],{cwd:at})).stdout.trim();
 await git(['init','-b','main']);await writeFile(join(cwd,'README.md'),'original\n');await git(['add','.']);await git(['commit','-m','Original commit']);await git(['clone','--bare',cwd,remote],root);const original=await git(['rev-parse','HEAD']);
 await git(['remote','add','origin','https://github.com/fixture/repo.git']);await git(['checkout','-b','coffee/alice/task']);
 await writeFile(join(remote,'hooks/pre-receive'),'#!/bin/sh\nwhile read old new ref; do\ncase "$(git show -s --format=%ae "$new")" in *@users.noreply.github.com) ;; *) echo "GH007: Your push would publish a private email address." >&2; exit 1;; esac\ndone\n',{mode:0o700});
 // External GitHub transport is local; config probes still resolve its public URL.
 const bridge=join(root,'git-transport');await writeFile(bridge,`#!${process.execPath}\nconst cp=require('node:child_process'),args=process.argv.slice(2);const network=args.some(x=>['push','fetch','ls-remote'].includes(x))&&!args.includes('--get-url');const result=cp.spawnSync('/usr/bin/git',[...(network?['-c',${JSON.stringify('url.'+remote+'.insteadOf=https://github.com/fixture/repo.git')}]:[]),...args],{stdio:'inherit'});process.exit(result.status??1);\n`,{mode:0o700});
 const accounts=new GitHubAccounts(join(root,'accounts'));await mkdir(accounts.root);await writeFile(accounts.file,JSON.stringify({version:1,accounts:[{id:'selected',githubId:'42',login:'alice',token:'fixture-token'},{id:'other',githubId:'43',login:'bob',token:'other-token'}]}),{mode:0o600});const env={...process.env,...await accounts.environment('selected','/usr/bin/false')};
 const pushed=await exec(process.execPath,[resolve('src/host/github-tools.mjs'),'git',accounts.file,'selected',bridge,'push','origin','HEAD:refs/heads/coffee/alice/task'],{cwd,env});
 expect(pushed.stderr).toContain('anonymous');const head=await git(['rev-parse','HEAD']);expect(head).not.toBe(original);
 expect(await git(['show','-s','--format=%ae%n%ce','HEAD'])).toBe('42+alice@users.noreply.github.com\n42+alice@users.noreply.github.com');
 expect(await git(['rev-parse','refs/heads/coffee/alice/task'],remote)).toBe(head);expect(await git(['rev-parse','main'],remote)).toBe(original);
});
