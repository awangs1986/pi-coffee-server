import {WriterAdmissionFence,BackupError,type CaptureLease} from './backup.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import type {ManagedNativeCustody} from './managed-native.js';

/** Kernel arbitration complements the synchronous Host admission epoch. The
 * source-ownership/deployment qualification remains ManagedSourceAuthority's job. */
export class ManagedWriterFence extends WriterAdmissionFence {
 private readonly kernelCuts=new Set<FileLease>();private revision=0;
 get changeRevision(){return this.revision;}
 constructor(private managed:{lock:string;custody:ManagedNativeCustody}){super({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>{const state=await managed.custody.state();return {known:state.state==='quiescent',active:state.state==='active',...(state.state!=='quiescent'?{reason:state.reason}:{})};}});if(managed.lock!==managed.custody.profile.lock)throw Error('Managed group lock mismatch');}
 override invalidate(reason?:string){
  this.revision++;
  // Drop EX synchronously before any platform/native side effect is admitted.
  for(const cut of this.kernelCuts)cut.release();this.kernelCuts.clear();super.invalidate(reason);
 }
 override beginWriter(writerClass:string){
  if(writerClass!=='platform'&&writerClass!=='native')throw new BackupError('writers_unknown','Unrestricted writer denied by managed profile');
  this.invalidate();const kernel=acquireFileLease(this.managed.lock,'shared');if(!kernel)throw new BackupError('writers_active','Managed consistency group is publishing a cut');
  let release:()=>void;try{release=super.beginWriter(writerClass);}catch(error){kernel.release();throw error;}
  let done=false;return ()=>{if(!done){done=true;try{release();}finally{this.revision++;kernel.release();}}};
 }
 override async lease():Promise<CaptureLease>{
  const lease=await super.lease();let kernel:FileLease|undefined;try{lease.assertValid();kernel=acquireFileLease(this.managed.lock,'exclusive');if(!kernel)throw new BackupError('writers_active','Managed native descendants remain active');lease.assertValid();this.kernelCuts.add(kernel);}catch(error){kernel?.release();lease.release();throw error;}
  const cut=kernel;let released=false;
  return {epoch:lease.epoch,signal:lease.signal,assertValid:()=>{if(released)throw new BackupError('capture_revoked','Managed cut released');lease.assertValid();cut.assertHeld();},release:()=>{if(!released){released=true;this.kernelCuts.delete(cut);cut.release();lease.release();}}};
 }
}
