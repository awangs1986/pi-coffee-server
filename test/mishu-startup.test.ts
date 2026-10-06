import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Full process boundary: the probe first creates explicit authorization through
// public HTTP/native UI, restarts actual main, and makes no recovery-driving API call.
it('real main recovers default and user MISHU reports without Browser reconnect',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/probe-mishu-startup.mjs'],{env:process.env,timeout:90000,maxBuffer:1024*1024});
 expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({passed:true,noReconnect:true,targetReplays:0,scopes:2,disabledWakes:0,corruptPreserved:true});
},100000);
