import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
export async function sourceIdentity(repo){
 const git=async(...args)=>(await exec('git',args,{cwd:repo,maxBuffer:8*1024*1024})).stdout.trim();
 const commit=await git('rev-parse','HEAD'),tree=await git('rev-parse','HEAD^{tree}');
 const names=(await exec('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:repo,maxBuffer:8*1024*1024})).stdout.split('\0').filter(Boolean).sort();
 const hash=createHash('sha256');
 for(const name of names){hash.update(name+'\0');try{const file=join(repo,name),meta=await lstat(file);if(!meta.isFile())throw Error('Non-regular source');hash.update(String(meta.mode&0o111));hash.update(await readFile(file));}catch(error){if(error.code==='ENOENT')hash.update('deleted');else throw error;}hash.update('\0');}
 return {commit,tree,sourceFingerprint:hash.digest('hex')};
}
