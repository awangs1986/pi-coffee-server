import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir} from 'node:fs/promises';
import {isAbsolute,resolve,join,relative} from 'node:path';
import {BackupError,type BackupCoordinator} from './backup.js';
import {NativeWriterCustody} from './native-custody.js';
import {PhysicalWriterFence} from './physical-writer-fence.js';
import {ManagedPublicationGate} from './managed-publication-gate.js';
import {TrustedSourceAuthority} from './trusted-source-authority.js';
import {TrustedSealedCheckpointSource} from './trusted-sealed-source.js';

export interface OrdinaryBackupProfile {
 schema:1;root:string;configuration:string;graph:string;sourceSocket:string;sourcePolicy:string;
 enrollment:{mode:'none'}|{mode:'fresh';actor:string};
}
const refused=()=>new BackupError('ordinary_backup_configuration_invalid','Ordinary backup requires a private explicit source profile');
const canonical=(value:unknown):value is string=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
const under=(parent:string,path:string)=>path===parent||(!relative(parent,path).startsWith('..')&&!isAbsolute(relative(parent,path)));
async function privateJson(path:string){
 if(!canonical(path)||await realpath(path)!==path)throw refused();const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o077)||info.size>65536)throw refused();const buffer=Buffer.alloc(65537),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead!==info.size)throw refused();return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));}finally{await file.close();}
}
export async function loadOrdinaryBackupProfile(path:string):Promise<OrdinaryBackupProfile>{
 const value=await privateJson(path);if(!value||value.schema!==1||Object.keys(value).some(key=>!['schema','root','configuration','graph','sourceSocket','sourcePolicy','enrollment'].includes(key))||!['root','configuration','graph','sourceSocket','sourcePolicy'].every(key=>canonical(value[key]))||!value.enrollment||!['fresh','none'].includes(value.enrollment.mode)||Object.keys(value.enrollment).some(key=>!['mode','actor'].includes(key))||value.enrollment.mode==='fresh'&&(typeof value.enrollment.actor!=='string'||!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value.enrollment.actor))||value.enrollment.mode==='none'&&value.enrollment.actor!==undefined)throw refused();return value;
}
/** Composition of actual ordinary custody, physical exclusion and owner authority.
 * No synthetic quiescent probe or caller-supplied qualification can enter this path.
 * Existing roots and restarted enrollments remain unknown until separately certified. */
export class OrdinaryBackupComposition {
 private source?:TrustedSealedCheckpointSource;
 private constructor(readonly profile:OrdinaryBackupProfile,readonly groupId:string,readonly custody:NativeWriterCustody,readonly physical:PhysicalWriterFence,readonly publicationGate:ManagedPublicationGate,readonly authority:TrustedSourceAuthority){}
 get fence(){return this.authority.writerFence('host');}
 static async open(profile:OrdinaryBackupProfile,backupRoot:string){
  if(!canonical(backupRoot))throw refused();const config=await privateJson(profile.configuration);
  if(!config||typeof config.groupId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(config.groupId)||!config.owner||typeof config.owner.administrator!=='string'||!Array.isArray(config.roots)||config.roots.some((root:any)=>!canonical(root?.path)||under(root.path,backupRoot)||under(backupRoot,root.path)))throw refused();
  await mkdir(profile.root,{recursive:true,mode:0o700});const info=await lstat(profile.root);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)||await realpath(profile.root)!==profile.root)throw refused();
  const publicationGate=new ManagedPublicationGate({path:join(profile.root,'publication.json'),groupId:config.groupId,restoreRoot:join(backupRoot,'restore-runtime')}),lock=join(profile.root,'group.lock'),custody=new NativeWriterCustody(join(profile.root,'custody'),{lock}),physical=new PhysicalWriterFence({lock,custody,publicationGate});
  const authority=await TrustedSourceAuthority.open({root:join(profile.root,'enrollment'),configuration:profile.configuration,graph:profile.graph,fence:physical,authorize:async actor=>actor===config.owner.administrator});
  if(profile.enrollment.mode==='fresh')try{await authority.enrollFresh(profile.enrollment.actor,[{id:'host',pid:process.pid}]);}catch{/* Enrollment failure does not disable ordinary tasks or repository extraction. */}
  return new OrdinaryBackupComposition(profile,config.groupId,custody,physical,publicationGate,authority);
 }
 async sourceProof(paths:readonly string[]):Promise<{known:boolean;reason?:string}>{
  try{const evidence=this.authority.verifyRoots(paths);if(evidence.groupId!==this.groupId||(await this.authority.qualification()).state!=='qualified')throw Error();return {known:true};}catch{return {known:false,reason:'Ordinary source coverage is not qualified'};}
 }
 async startSource(coordinator:BackupCoordinator,maxBytes?:number){if(this.source)throw refused();this.source=new TrustedSealedCheckpointSource({socket:this.profile.sourceSocket,policyFile:this.profile.sourcePolicy,coordinator,maxBytes});await this.source.listen();}
 async close(){await this.source?.close();await this.authority.close();}
}
