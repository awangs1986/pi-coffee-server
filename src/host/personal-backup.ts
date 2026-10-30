import {mkdir,lstat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {NativeWriterCustody} from './native-custody.js';
import {PhysicalWriterFence} from './physical-writer-fence.js';
import {ManagedPublicationGate} from './managed-publication-gate.js';
import {durableFile} from './restore-files.js';

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
