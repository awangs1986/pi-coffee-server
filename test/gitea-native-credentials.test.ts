import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {GitHubAccounts} from '../src/host/github-accounts.js';
function git(env:Record<string,string>,args:string[],input=''){
 return new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn('git',args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
 });
}
it('uses the participant’s native Git credential and refuses a wrongly bound owner token',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-gitea-git-'));
 const api=createServer((req,res)=>{const own=req.headers.authorization==='token participant-fixture';res.setHeader('content-type','application/json');res.end(JSON.stringify({id:own?2:1,login:own?'participant':'owner',active:true}));});
 await new Promise<void>(done=>api.listen(0,'127.0.0.1',done));const address=api.address();if(!address||typeof address==='string')throw Error('fixture address');
 const url=`http://127.0.0.1:${address.port}`,input=`protocol=http\nhost=127.0.0.1:${address.port}\n\n`;
 try{
  const good=new GitHubAccounts(join(root,'good'),{gitea:{url,owner:'participant',userId:2,token:'participant-fixture'}});
  const allowed=await git(await good.environment(undefined),['credential','fill'],input);
  expect(allowed.code).toBe(0);expect(allowed.stdout).toContain('username=participant\n');expect(allowed.stdout).toContain('password=participant-fixture\n');
  const bad=new GitHubAccounts(join(root,'bad'),{gitea:{url,owner:'participant',userId:2,token:'wrong-owner-fixture'}});
  const denied=await git(await bad.environment(undefined),['credential','fill'],input);
  expect(denied.code).not.toBe(0);expect(denied.stdout).not.toContain('wrong-owner-fixture');
 }finally{await new Promise<void>(done=>api.close(()=>done()));await rm(root,{recursive:true,force:true});}
});

it('authors the participant’s commits as that account instead of the VM owner',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-gitea-author-'));
 const previous={name:process.env.GIT_AUTHOR_NAME,email:process.env.GIT_AUTHOR_EMAIL};
 process.env.GIT_AUTHOR_NAME='Ambient Owner';process.env.GIT_AUTHOR_EMAIL='owner@example.test';
 try{
  const accounts=new GitHubAccounts(root,{gitIdentity:{name:'Participant',email:'participant@example.test'}});
  const result=await git(await accounts.environment(undefined),['var','GIT_AUTHOR_IDENT']);
  expect(result.code).toBe(0);expect(result.stdout).toMatch(/^Participant <participant@example\.test> /);
 }finally{
  if(previous.name===undefined)delete process.env.GIT_AUTHOR_NAME;else process.env.GIT_AUTHOR_NAME=previous.name;
  if(previous.email===undefined)delete process.env.GIT_AUTHOR_EMAIL;else process.env.GIT_AUTHOR_EMAIL=previous.email;
  await rm(root,{recursive:true,force:true});
 }
});
