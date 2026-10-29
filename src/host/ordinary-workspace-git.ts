import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {mkdtemp,writeFile,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {NativeWriterCustody} from './native-custody.js';

// This trusted shim reports the Git command's normal completion independently
// of the enclosing subreaper, which must keep custody of detached helpers.
// It inherits the same cwd/environment as the old direct Host Git invocation.
const commandProgram=String.raw`
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const root=process.argv[1],request=JSON.parse(fs.readFileSync(path.join(root,'request.json'),'utf8'));
let out=[],err=[],outBytes=0,errBytes=0,failure,done=false;
const child=cp.spawn('git',['-c','core.hooksPath=/dev/null',...request.args],{stdio:['ignore','pipe','pipe'],env:process.env});
const cancel=code=>{failure??=code;if(child.exitCode!==null||child.signalCode!==null)finish(child.exitCode,child.signalCode);else child.kill('SIGTERM');};
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>cancel('ETIMEDOUT'));
const timer=setTimeout(()=>cancel('ETIMEDOUT'),request.timeout);
function collect(chunk,stderr){if(done)return;let used=stderr?errBytes:outBytes;const keep=chunk.subarray(0,Math.max(0,request.maxBuffer-used));(stderr?err:out).push(keep);used+=chunk.length;if(stderr)errBytes=used;else outBytes=used;if(used>request.maxBuffer)cancel('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');}
child.stdout.on('data',chunk=>collect(chunk,false));child.stderr.on('data',chunk=>collect(chunk,true));
child.on('error',()=>{failure='ENOENT';});
function finish(code,signal){if(done)return;done=true;clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();const value={schema:1,code,signal,failure,stdout:Buffer.concat(out).toString('base64'),stderr:Buffer.concat(err).toString('base64')};const temporary=path.join(root,'result.tmp'),fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,path.join(root,'result.json'));const parent=fs.openSync(root,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
child.on('exit',(code,signal)=>{if(failure)finish(code,signal);});
child.on('close',finish);
`;

export async function ordinaryWorkspaceGit(custody:NativeWriterCustody,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;timeout:number;maxBuffer:number}):Promise<{stdout:Buffer;stderr:Buffer}>{
 const root=await mkdtemp(join(tmpdir(),'coffee-git-result-'));let child:ReturnType<typeof spawn>|undefined,completed=false;
 try{
  const request=JSON.stringify({args,timeout:options.timeout,maxBuffer:options.maxBuffer});
  if(!Number.isSafeInteger(options.maxBuffer)||options.maxBuffer<1||options.maxBuffer>16*1024*1024||!Number.isSafeInteger(options.timeout)||options.timeout<1||Buffer.byteLength(request)>8*1024*1024)throw Error('Workspace Git request exceeds its resource budget');
  await writeFile(join(root,'request.json'),request,{flag:'wx',mode:0o600});
  const launch=await custody.prepare({executable:process.execPath,args:['-e',commandProgram,root]});
  child=spawn(process.execPath,[launch.cliPath],{cwd:options.cwd,env:{...options.env,...launch.env},stdio:'ignore'});child.unref();let launchFailure:Error|undefined;
  child.once('error',error=>{launchFailure=error;});
  const deadline=Date.now()+options.timeout+5000,limit=Math.ceil(options.maxBuffer*8/3)+4096;
  for(;;){
   if(launchFailure)throw launchFailure;
   let raw:Buffer|undefined;
   try{
    const file=await open(join(root,'result.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=await file.stat();if(!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o077)||stat.nlink!==1||stat.size>limit)throw Error('Workspace Git result is invalid');raw=Buffer.alloc(stat.size+1);let offset=0;for(;;){const read=await file.read(raw,offset,raw.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;if(offset===raw.length)break;}if(offset!==stat.size||(await file.stat()).size!==stat.size)throw Error('Workspace Git result changed');raw=raw.subarray(0,offset);}finally{await file.close();}
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(raw){
    const value=JSON.parse(raw.toString('utf8'));if(value.schema!==1||typeof value.stdout!=='string'||typeof value.stderr!=='string'||value.code!==null&&!Number.isInteger(value.code)||value.signal!==null&&typeof value.signal!=='string'||value.failure!==undefined&&typeof value.failure!=='string')throw Error('Workspace Git result is invalid');
    const stdout=Buffer.from(value.stdout,'base64'),stderr=Buffer.from(value.stderr,'base64');if(stdout.length>options.maxBuffer||stderr.length>options.maxBuffer||stdout.toString('base64')!==value.stdout||stderr.toString('base64')!==value.stderr)throw Error('Workspace Git result exceeds its resource budget');
    completed=true;if(value.failure||value.code!==0)throw Object.assign(new Error(stderr.toString('utf8')||'Workspace Git command failed'),{code:value.failure??value.code,signal:value.signal,stdout,stderr,killed:Boolean(value.failure)});
    return {stdout,stderr};
   }
   if(child.exitCode!==null||child.signalCode!==null)throw Error('Workspace Git custody ended without a command result');
   if(Date.now()>=deadline)throw Object.assign(new Error('Workspace Git command timed out'),{code:'ETIMEDOUT'});
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }finally{
  // A completed Git command may leave legitimate helpers. Never terminate their
  // custodian just to return a result or manufacture a backup window.
  const cleanup=()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  if(!completed&&child?.pid&&child.exitCode===null&&child.signalCode===null){
   // The shim may still publish its result after a timeout. Retain its private
   // channel until the actual publisher and adopted helpers have exited; a
   // cleanup race must not replace the command's original failure.
   child.once('close',()=>{void cleanup().catch(()=>{});});
   child.kill('SIGTERM');
  }else await cleanup();
 }
}
