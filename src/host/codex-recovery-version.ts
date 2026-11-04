import {execFile} from 'node:child_process';
/** A version hint is observed from the configured executable, never assumed from
 * an environment label. Store schema and rollout versions are checked separately. */
export async function codexRecoveryVersion(command:string):Promise<string>{
 return new Promise(resolve=>{execFile(command,['--version'],{timeout:5000,maxBuffer:8192,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8'}},(error,stdout)=>{const version=String(stdout).trim().match(/^codex-cli (\d+\.\d+\.\d+)$/)?.[1];resolve(error||!version?'unknown':version);});});
}
