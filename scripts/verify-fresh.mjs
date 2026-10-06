import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile),args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
let root;
try{
 const url=take('--remote')||'https://github.com/awangs1986/pi-coffee-server.git',commit=take('--commit');if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Exact commit required');
 const fixture=args.includes('--fixture');if(fixture){if(!url.startsWith('/'))throw Error('Fixture forge must be local');}else{const u=new URL(url);if(u.protocol!=='https:'||u.host!=='github.com'||u.username||u.password)throw Error('Public GitHub source required');}
 const base=join(homedir(),'.cache','pi-coffee','fresh-verification');await mkdir(base,{recursive:true,mode:0o700});root=await mkdtemp(join(base,'run-'));const repo=join(root,'repo'),receipt=resolve(take('--receipt')||'.coffee-verification/fresh.json');
 const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',TMPDIR:root,TMP:root,TEMP:root};
 await exec('/usr/bin/git',['-c','credential.helper=','clone','--no-hardlinks',url,repo],{env,maxBuffer:8*1024*1024});await exec('/usr/bin/git',['checkout','--detach',commit],{cwd:repo,env});
 if(!fixture)await exec('npm',['ci'],{cwd:repo,env,maxBuffer:16*1024*1024,timeout:600000});
 const plan=fixture?take('--plan'):join(repo,'scripts/verification-plan.json');if(!plan)throw Error('Fixture plan required');
 await exec(process.execPath,[fixture?resolve('scripts/verify.mjs'):join(repo,'scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',join(root,'receipt.json')],{env,maxBuffer:32*1024*1024,timeout:600000});
 const stage=take('--stage-config');if(stage)await exec(process.execPath,[fixture?resolve('scripts/release.mjs'):join(repo,'scripts/release.mjs'),'stage','--source',repo,'--commit',commit,'--verification',join(root,'receipt.json'),'--config',resolve(stage),'--role',take('--role')||'browser'],{env,maxBuffer:8*1024*1024,timeout:600000});
 const value={...JSON.parse(await readFile(join(root,'receipt.json'),'utf8')),freshClone:true};if(value.commit!==commit||value.status!=='passed')throw Error('Fresh verification failed');
 await mkdir(dirname(receipt),{recursive:true,mode:0o700});const temp=receipt+'.'+randomUUID();await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,receipt);console.log(JSON.stringify({freshClone:true,commit,status:'passed'}));
}catch{console.error('Fresh-clone verification failed; source is not approved for release.');process.exitCode=1;}
finally{if(root)await rm(root,{recursive:true,force:true});}
