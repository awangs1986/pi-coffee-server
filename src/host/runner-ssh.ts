import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import type {Writable} from 'node:stream';
import type {Runner} from './runners.js';
export type RunnerOperation={kind:'test'}|{kind:'exec';command:string}|{kind:'upload';local:string;remote:string}|{kind:'download';local:string;remote:string};
export interface RunnerResult {code:number;stdout:string;stderr:string;}
const sh=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const ps=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export function runnerInvocation(runner:Runner,knownHosts:string,operation:RunnerOperation,password:boolean){
 const options=['-F','/dev/null','-o',`UserKnownHostsFile=${knownHosts}`,'-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=10','-o','ConnectionAttempts=1','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o',`BatchMode=${password?'no':'yes'}`,'-o','NumberOfPasswordPrompts=1'];
 if(password)options.push('-o','PreferredAuthentications=password,keyboard-interactive');
 if(operation.kind==='upload'||operation.kind==='download'){
  if(!operation.remote||/[\x00-\x1f\x7f]/.test(operation.remote)||! /^(?:\/|[a-zA-Z]:[\\/])/.test(operation.remote))throw new Error('Use an absolute remote transfer path');
  const remote=`${runner.username}@${runner.host.includes(':')?'['+runner.host+']':runner.host}:${operation.remote}`;
  const local=resolve(operation.local);
  return {program:'scp',args:[...options,'-P',String(runner.port),'-r','--',...(operation.kind==='upload'?[local,remote]:[remote,local])]};
 }
 const command=operation.kind==='test' ? (runner.platform==='windows'?"Write-Output 'coffee-runner-ready'":"printf '%s\\n' coffee-runner-ready") : operation.command;
 if(!command||command.length>65536||command.includes('\0'))throw new Error('Invalid remote command');
 const script=runner.platform==='windows'
  ? "$ErrorActionPreference='Stop'; "+(runner.workdir?`Set-Location -LiteralPath ${ps(runner.workdir)}; `:'')+`& { ${command}\n}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $?) { exit 1 }`
  : (runner.workdir?`cd -- ${sh(runner.workdir)} && `:'')+`sh -lc ${sh(command)}`;
 const remote=runner.platform==='windows'?`powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`:script;
 return {program:'ssh',args:[...options,'-p',String(runner.port),'-l',runner.username,'--',runner.host,remote]};
}
export function runRunner(runner:Runner,password:string|undefined,knownHosts:string,operation:RunnerOperation):Promise<RunnerResult>{
 const invocation=runnerInvocation(runner,knownHosts,operation,Boolean(password));
 return new Promise((resolve,reject)=>{
  const child=spawn(password?'sshpass':invocation.program,password?['-d','3',invocation.program,...invocation.args]:invocation.args,{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe',password?'pipe':'ignore']});
  let stdout='',stderr='',size=0,failure:string|undefined;
  const kill=()=>{
   // sshpass starts SSH in a new session. Include descendants before killing the wrapper.
   const descendants=(pid:number):number[]=>{try{return readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number).flatMap(id=>[...descendants(id),id]);}catch{return [];}};
   if(child.pid)for(const pid of [...descendants(child.pid),child.pid]){try{process.kill(pid,'SIGKILL');}catch{}}
   try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}
  };
  const fail=(message:string)=>{failure=message;kill();child.stdout?.destroy();child.stderr?.destroy();clearTimeout(timer);reject(new Error(message));};
  const timer=setTimeout(()=>{fail('Remote operation timed out');},operation.kind==='test'?20000:600000);
  const collect=(chunk:Buffer,out:boolean)=>{size+=chunk.length;if(size>1024*1024){fail('Remote output exceeded 1 MiB');return;}if(out)stdout+=chunk.toString();else stderr+=chunk.toString();};
  child.stdout!.on('data',c=>collect(c,true));child.stderr!.on('data',c=>collect(c,false));
  child.on('error',()=>{clearTimeout(timer);reject(new Error('SSH could not start; install openssh-client and sshpass on the Host for password authentication'));});
  child.on('close',code=>{clearTimeout(timer);if(failure)reject(new Error(failure));else resolve({code:code??1,stdout,stderr});});
  if(password){const pipe=child.stdio[3] as Writable;pipe.on('error',()=>undefined);pipe.end(password+'\n');}
 });
}
