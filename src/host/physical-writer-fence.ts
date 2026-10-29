import {AsyncLocalStorage} from 'node:async_hooks';
import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {WriterAdmissionFence,BackupError,type CaptureLease,type RecoveryPublication} from './backup.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {isNativeWriterCustody,type NativeCustodyState,type NativeWriterCustody} from './native-custody.js';
import {sourceGroupLockIdentity,assertSourceGroupLock,type SourceGroupLockIdentity} from './source-group-lock.js';
import type {ManagedPublicationGate} from './managed-publication-gate.js';

export interface PhysicalWriterCustody {readonly groupLock?:string;state():Promise<NativeCustodyState>;}
const auditContext=new AsyncLocalStorage<AbortController>();
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
 private readonly kernelCuts=new Set<FileLease>();private revision=0;private publications=0;private activeAdmissions=0;private audit?:AbortController;private uncoveredAdmission=false;
 get changeRevision(){return this.revision;}
 constructor(options:{lock:string;custody:PhysicalWriterCustody;publicationGate?:ManagedPublicationGate}){const physical={...options};super({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>{const state=await physical.custody.state();return {known:state.state==='quiescent',active:state.state==='active',...(state.state!=='quiescent'?{reason:state.reason}:{})};}});if(physical.lock!==physical.custody.groupLock)throw Error('Source group lock mismatch');this.physical=physical;this.lockIdentity=sourceGroupLockIdentity(physical.lock,true);fenceCustody.set(this,{custody:physical.custody,lock:physical.lock});}
 private acquire(mode:'shared'|'exclusive'){assertSourceGroupLock(this.lockIdentity);const lease=acquireFileLease(this.physical.lock,mode);try{assertSourceGroupLock(this.lockIdentity);return lease;}catch(error){lease?.release();throw error;}}
 override invalidate(reason?:string){
  if(this.audit&&auditContext.getStore()!==this.audit)this.audit.abort(new BackupError('capture_revoked','New source activity takes priority over native audit'));
  this.revision++;
  // Drop EX synchronously before any platform/native side effect is admitted.
  if(!this.publications){for(const cut of this.kernelCuts)cut.release();this.kernelCuts.clear();}super.invalidate(reason);
 }
 override beginWriter(writerClass:string){
  this.physical.publicationGate?.assertAdmission();
  if(this.publications)throw new BackupError('writers_active','Source publication is settling');
  this.invalidate();const kernel=this.acquire('shared');if(!kernel)throw new BackupError('writers_active','Source consistency group is publishing a cut');
  let release:()=>void;try{release=super.beginWriter(writerClass);this.activeAdmissions++;if(!['platform','native'].includes(writerClass))this.uncoveredAdmission=true;}catch(error){kernel.release();throw error;}
  let done=false;return ()=>{if(!done){done=true;try{release();}finally{this.activeAdmissions--;this.revision++;kernel.release();}}};
 }
 /** Only admission for an owned audit process, never a capture/source proof. */
 async runNativeAudit<T>(signal:AbortSignal,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(this.audit||this.activeAdmissions||this.publications)throw new BackupError('writers_active','Source writers take priority over native audit');
  if(this.uncoveredAdmission||!isNativeWriterCustody(this.physical.custody))throw new BackupError('writers_unknown','Native audit custody is unqualified');
  this.physical.publicationGate?.assertAdmission();
  const controller=new AbortController(),cancel=()=>controller.abort(new BackupError('capture_revoked','Native audit cancelled'));this.audit=controller;
  const timer=setTimeout(cancel,15000);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  try{
   controller.signal.throwIfAborted();const custody=this.physical.custody,state=await custody.state();
   if(state.state==='active')throw new BackupError('writers_active','Native writers take priority over native audit');
   if(state.state==='unknown'&&!await this.pristineCustody(custody))throw new BackupError('writers_unknown','Native audit cannot erase unresolved custody');
   controller.signal.throwIfAborted();if(this.activeAdmissions)throw new BackupError('writers_active','Source writer admitted during native audit check');
   const exclusion=this.acquire('exclusive');if(!exclusion)throw new BackupError('writers_active','Native descendants take priority over audit');exclusion.release();
   const result=await auditContext.run(controller,()=>run(controller.signal));controller.signal.throwIfAborted();return result;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);if(this.audit===controller)this.audit=undefined;}
 }
 private async pristineCustody(custody:NativeWriterCustody):Promise<boolean>{
  try{const info=await lstat(custody.root);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)||await realpath(custody.root)!==custody.root)return false;
   const entries=await readdir(custody.root);if(!entries.length)return true;if(entries.length!==1||entries[0]!=='group-lock.json')return false;
   const path=join(custody.root,'group-lock.json'),file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid?.()||(file.mode&0o077)||file.size>65536)return false;
   return JSON.stringify(JSON.parse(await readFile(path,'utf8')))===JSON.stringify(this.lockIdentity);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return false;
   // Only an absent custody root is bootstrap. A missing child receipt is not.
   try{await lstat(custody.root);return false;}catch(missing){if((missing as NodeJS.ErrnoException).code!=='ENOENT')return false;}
   try{const parent=dirname(custody.root),info=await lstat(parent);return info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid?.()&&!(info.mode&0o077)&&await realpath(parent)===parent;}catch{return false;}
  }
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
