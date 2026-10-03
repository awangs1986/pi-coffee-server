import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);let root='';afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});});
it('authorizes the actual Git target, preserving local clones, local fetch/push and Gitea transport',async()=>{
 root=await mkdtemp(join(tmpdir(),'coffee-git-target-'));const caller=join(root,'caller'),source=join(root,'source');await mkdir(caller);await mkdir(source);
 const env={...process.env,GIT_CONFIG_COUNT:'0',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GH_CONFIG_DIR:root};
 const git=(args:string[],cwd=caller)=>exec('/usr/bin/git',args,{cwd,env});
 await git(['init']);await git(['remote','add','origin','https://github.com/example/unrelated.git']);await git(['init','--bare'],source);
 await writeFile(join(root,'accounts.json'),JSON.stringify({version:1,accounts:[]}));await writeFile(join(root,'transport.json'),JSON.stringify({identity:{}}));
 const wrapper=resolve('src/host/github-tools.mjs');
 const managed=(args:string[],program='/usr/bin/git',id='')=>exec(process.execPath,[wrapper,'git',join(root,'accounts.json'),id,program,...args],{cwd:caller,env});
 await expect(managed(['clone','--bare',source,join(root,'clone.git')])).resolves.toBeDefined();
 await git(['remote','add','local',source]);await expect(managed(['fetch','local'])).resolves.toBeDefined();
 await git(['remote','set-url','--push','origin',source]);
 // A real local push can fail for missing refs, but must reach Git, not fail auth.
 await expect(managed(['push','origin'])).rejects.not.toThrow('authorization is missing');
 await expect(managed(['clone','-b','main','https://github.com/example/private.git',join(root,'denied')])).rejects.toThrow('authorization is missing');
 await expect(managed(['fetch','origin'])).rejects.toThrow('authorization is missing');
 await git(['remote','set-url','--push','origin','https://github.com/example/private.git']);
 await expect(managed(['push','-u','origin','main'])).rejects.toThrow('authorization is missing');
 await expect(managed(['push','-s','origin','main'])).rejects.toThrow('authorization is missing');
 await expect(managed(['clone','-s','https://github.com/example/private.git',join(root,'shared-denied')])).rejects.toThrow('authorization is missing');

 // Test transport selection without making an external network call.
 const mock=join(root,'record-git');await writeFile(mock,'#!/bin/sh\ncase "$1" in clone) exit 0;; *) exec /usr/bin/git "$@";; esac\n',{mode:0o700});
 await expect(managed(['clone','http://gitea:3000/owner/repo.git',join(root,'gitea')],mock,'disconnected')).resolves.toBeDefined();
 await git(['config','url.https://github.com/.insteadOf','fixture-gh:']);
 await expect(managed(['ls-remote','fixture-gh:owner/private.git'])).rejects.toThrow('authorization is missing');
 await expect(managed(['ls-remote','--get-url','origin'])).resolves.toBeDefined();
 await git(['config','url.https://github.com/.pushInsteadOf','fixture-push:']);
 await expect(managed(['push','fixture-push:owner/repo','main'])).rejects.toThrow('authorization is missing');
 await git(['init','--bare','origin']);
 await expect(managed(['clone','--bare','origin',join(root,'named-local.git')])).resolves.toBeDefined();
 await git(['config','remotes.team','origin']);
 await expect(managed(['fetch','team'])).rejects.toThrow('authorization is missing');
 await expect(managed(['fetch','--multiple','local','team'])).rejects.toThrow('authorization is missing');
 await expect(managed(['clone','-c','url.https://github.com/.insteadOf=fixture:','fixture:owner/repo',join(root,'rewrite-denied')])).rejects.toThrow('authorization is missing');
 await expect(managed(['-c','url.'+source+'/.insteadOf=https://github.com/','push','fixture-push:owner/repo','main'])).rejects.toThrow('authorization is missing');

});
