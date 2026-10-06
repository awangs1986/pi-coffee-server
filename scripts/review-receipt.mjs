import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {sourceIdentity} from './lib/source-identity.mjs';
const args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
try{
 if(take('--verdict')!=='passed'||!take('--evidence'))throw Error('Explicit successful review and evidence required');
 const evidence=await readFile(resolve(take('--evidence')));if(!evidence.length)throw Error('Empty review');
 const value={version:1,...await sourceIdentity(resolve(take('--repo')||'.')),status:'passed',evidenceSha256:createHash('sha256').update(evidence).digest('hex')};
 const file=resolve(take('--output')||'.coffee-verification/review.json');await mkdir(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,file);console.log('Recorded review for '+value.tree);
}catch{console.error('Review receipt failed: explicit verdict and readable evidence required.');process.exitCode=1;}
