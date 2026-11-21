import {readFile,readdir,mkdir,lstat,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {unlinkSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {BackupError} from './backup.js';
import {NativeWriterCustody} from './native-custody.js';
import {PhysicalWriterFence} from './physical-writer-fence.js';
import {ManagedPublicationGate} from './managed-publication-gate.js';
import {durableFile,syncDir} from './restore-files.js';

/** Trusted-owner composition. Custody tracks subprocess lifetime for consistency,
 * not operator identity. No broker, producer registry or role-policy service.
 * External writers remain outside this supported single-Host topology. */
export class PersonalBackup {
 private constructor(readonly root:string,readonly custody:NativeWriterCustody,readonly fence:PhysicalWriterFence,readonly publicationGate:ManagedPublicationGate){}
 static async open(root:string){
  root=resolve(root);const runtime=join(root,'personal');await mkdir(runtime,{recursive:true,mode:0o700});
  const lock=join(runtime,'writers.lock'),custody=new NativeWriterCustody(join(runtime,'writers'),{lock,allowUnused:true});
  await mkdir(custody.root,{recursive:true,mode:0o700});
  const gate=new ManagedPublicationGate({path:join(runtime,'publication.json'),groupId:'personal',restoreRoot:join(root,'restore-runtime')});
  return new PersonalBackup(root,custody,new PhysicalWriterFence({lock,custody,publicationGate:gate}),gate);
 }
 async sourceProof(){
  const unknown=await lstat(join(this.root,'unmanaged-writer-seen')).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
  return unknown?{known:false,reason:'An external writer needs an operator-coordinated stable window'}:{known:true};
 }
 async requalify(){
  if((await this.sourceProof()).known)return;
  await this.fence.requalifyPersonalSource(checkPersonalWriterWindow,()=>{
   unlinkSync(join(this.root,'unmanaged-writer-seen'));
  });
  await syncDir(this.root);
 }
 async inventoryConnection(token:string){
  if(!token.trim()||/[\r\n]/.test(token))throw Error('Invalid Host inventory credential');
  const tokenFile=join(this.root,'personal','inventory-token');await durableFile(tokenFile,token);
  return {url:'http://127.0.0.1:0',tokenFile,actor:'awangs'};
 }
 async uncoordinatedWriter(){
  this.fence.invalidate('Uncoordinated native writer');
  await writeFile(join(this.root,'unmanaged-writer-seen'),'Uncoordinated native writer; reconcile before capture.\n',{mode:0o600,flush:true});
 }
}

// In the supported single-Host topology, unmanaged native descendants inherit
// the Host service cgroup even after their immediate parent exits. Sites that
// launch producers outside it supply a local check for their coordinated window.
async function checkPersonalWriterWindow(){
 const checker=process.env.PI_COFFEE_BACKUP_CHECK_QUIESCENT;
 if(checker){
  if(!isAbsolute(checker))throw new BackupError('writers_unknown','Invalid site writer check');
  try{await promisify(execFile)(checker,[],{timeout:5000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});}
  catch{throw new BackupError('writers_unknown','Stable source window is unconfirmed');}
  return;
 }
 const group=(await readFile('/proc/self/cgroup','utf8')).trim().match(/^0::(\/[^\n]*\/pi-coffee-workbench-host\.service)$/)?.[1];
 if(!group)throw new BackupError('writers_unknown','A local source window check is required');
 async function checkGroup(dir:string){
  const pids=(await readFile(join(dir,'cgroup.procs'),'utf8')).trim().split(/\s+/).filter(Boolean);
  if(pids.some(pid=>Number(pid)!==process.pid))throw new BackupError('writers_active','Host descendants are still active');
  for(const entry of await readdir(dir,{withFileTypes:true}))if(entry.isDirectory())await checkGroup(join(dir,entry.name));
 }
 await checkGroup(join('/sys/fs/cgroup',group));
}
