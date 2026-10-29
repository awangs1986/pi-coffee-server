import {WriterAdmissionFence,BackupError,type CaptureLease,type RecoveryPublication} from './backup.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {isNativeWriterCustody,type NativeCustodyState,type NativeWriterCustody} from './native-custody.js';
import {sourceGroupLockIdentity,assertSourceGroupLock,type SourceGroupLockIdentity} from './source-group-lock.js';
import type {ManagedPublicationGate} from './managed-publication-gate.js';

export interface PhysicalWriterCustody {readonly groupLock?:string;state():Promise<NativeCustodyState>;}
const fenceCustody=new WeakMap<object,{custody:PhysicalWriterCustody;lock:string}>();
/** Local launch binding only, never whole-source enrollment proof. */
export function physicalFenceCoversCustody(fence:unknown,custody:unknown):custody is NativeWriterCustody {if(typeof fence!=='object'||fence===null||!isNativeWriterCustody(custody))return false;const bound=fenceCustody.get(fence);return Boolean(bound&&bound.custody===custody&&bound.lock===custody.groupLock);}
const physicalCaptureLeases=new WeakMap<CaptureLease,{fence:PhysicalWriterFence;assertValid:()=>void}>();
export function assertPhysicalCaptureLease(fence:PhysicalWriterFence,lease:CaptureLease){const held=physicalCaptureLeases.get(lease);if(held?.fence!==fence)throw Error('Actual source physical capture lease required');held.assertValid();}
const physicalPublicationLeases=new WeakSet<CaptureLease>();
export const isPhysicalPublicationLease=(lease:CaptureLease)=>physicalPublicationLeases.has(lease);

/** Kernel arbitration complements the synchronous Host admission epoch. The
 * source enrollment and unrelated producer coverage remain the authority's job. */
export class PhysicalWriterFence extends WriterAdmissionFence {
 private readonly physical:{lock:string;custody:PhysicalWriterCustody;publicationGate?:ManagedPublicationGate};
 private readonly lockIdentity:SourceGroupLockIdentity;
 private readonly kernelCuts=new Set<FileLease>();private revision=0;private publications=0;
 get changeRevision(){return this.revision;}
 constructor(options:{lock:string;custody:PhysicalWriterCustody;publicationGate?:ManagedPublicationGate}){const physical={...options};super({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>{const state=await physical.custody.state();return {known:state.state==='quiescent',active:state.state==='active',...(state.state!=='quiescent'?{reason:state.reason}:{})};}});if(physical.lock!==physical.custody.groupLock)throw Error('Source group lock mismatch');this.physical=physical;this.lockIdentity=sourceGroupLockIdentity(physical.lock,true);fenceCustody.set(this,{custody:physical.custody,lock:physical.lock});}
 private acquire(mode:'shared'|'exclusive'){assertSourceGroupLock(this.lockIdentity);const lease=acquireFileLease(this.physical.lock,mode);try{assertSourceGroupLock(this.lockIdentity);return lease;}catch(error){lease?.release();throw error;}}
 override invalidate(reason?:string){
  this.revision++;
  // Drop EX synchronously before any platform/native side effect is admitted.
  if(!this.publications){for(const cut of this.kernelCuts)cut.release();this.kernelCuts.clear();}super.invalidate(reason);
 }
 override beginWriter(writerClass:string){
  this.physical.publicationGate?.assertAdmission();
  if(this.publications)throw new BackupError('writers_active','Source publication is settling');
  this.invalidate();const kernel=this.acquire('shared');if(!kernel)throw new BackupError('writers_active','Source consistency group is publishing a cut');
  let release:()=>void;try{release=super.beginWriter(writerClass);}catch(error){kernel.release();throw error;}
  let done=false;return ()=>{if(!done){done=true;try{release();}finally{this.revision++;kernel.release();}}};
 }
 override async publicationLease():Promise<CaptureLease>{
  const lease=await this.cutLease(true);try{lease.assertValid();this.publications++;}catch(error){lease.release();throw error;}let released=false;
  const publication:CaptureLease={epoch:lease.epoch,signal:lease.signal,publicationFd:lease.publicationFd,assertValid:()=>lease.assertValid(),release:()=>{if(!released){released=true;physicalPublicationLeases.delete(publication);try{lease.release();}finally{this.publications--;this.revision++;}}}};physicalPublicationLeases.add(publication);return publication;
 }
 override async runRecoveryPublication<T>(authority:RecoveryPublication,run:()=>Promise<T>):Promise<T>{if(!this.publications||!physicalPublicationLeases.has(authority.lease)||authority.lease.publicationFd===undefined||![...this.kernelCuts].some(cut=>cut.fd===authority.lease.publicationFd))throw new BackupError('recovery_publication_required','Registry import requires the held physical publication lease');this.physical.publicationGate?.assertApprovedOperation(authority.operationId,authority.digest);authority.lease.assertValid();const result=await run();authority.lease.assertValid();return result;}
 override async lease():Promise<CaptureLease>{return this.cutLease(false);}
 private async cutLease(publication:boolean):Promise<CaptureLease>{
  if(publication)this.physical.publicationGate?.assertPublication();else this.physical.publicationGate?.assertAdmission();
  const lease=await super.lease();let kernel:FileLease|undefined;try{lease.assertValid();kernel=this.acquire('exclusive');if(!kernel)throw new BackupError('writers_active','Native descendants remain active');lease.assertValid();this.kernelCuts.add(kernel);}catch(error){kernel?.release();lease.release();throw error;}
  const cut=kernel;let released=false;
  const result:CaptureLease={epoch:lease.epoch,signal:lease.signal,...(publication?{publicationFd:cut.fd}:{}),assertValid:()=>{if(released)throw new BackupError('capture_revoked','Source cut released');lease.assertValid();assertSourceGroupLock(this.lockIdentity);cut.assertHeld();},release:()=>{if(!released){released=true;this.kernelCuts.delete(cut);physicalCaptureLeases.delete(result);cut.release();lease.release();}}};physicalCaptureLeases.set(result,{fence:this,assertValid:result.assertValid});return result;
 }
}
