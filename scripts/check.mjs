import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
// All test fixtures (including tests that omit their own cleanup) belong to this run.
const base=process.env.PI_COFFEE_CHECK_TMP_ROOT || join(homedir(),'.cache','pi-coffee','checks');
await mkdir(base,{recursive:true,mode:0o700});
const root=await mkdtemp(join(base,'run-'));
let child;
const stop=signal=>{if(child?.pid){try{process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch{}}};
const interrupt=signal=>{stop(signal);};
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
const run=(args,program=process.execPath)=>new Promise((resolve,reject)=>{
 child=spawn(program,args,{stdio:'inherit',detached:process.platform!=='win32',env:{...process.env,TMPDIR:root,TMP:root,TEMP:root}});
 child.on('error',reject);child.on('exit',(code)=>{stop('SIGKILL');child=undefined;resolve(code??1);});
});
try {
 let code=await run(['node_modules/eslint/bin/eslint.js','public','scripts','eslint.config.mjs']);
 if(!code)code=await run(['run','build'],'npm');
 if(!code)code=await run(['node_modules/vitest/vitest.mjs','run']);
 if(!code)code=await run(['scripts/check-browser.mjs']);
 process.exitCode=code;
} finally {stop('SIGKILL');await rm(root,{recursive:true,force:true});}
