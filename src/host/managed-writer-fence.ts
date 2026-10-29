import {BackupError} from './backup.js';
import {PhysicalWriterFence} from './physical-writer-fence.js';
import type {ManagedNativeCustody} from './managed-native.js';
import type {ManagedPublicationGate} from './managed-publication-gate.js';
export {isPhysicalPublicationLease as isManagedPublicationLease} from './physical-writer-fence.js';

/** Compatibility policy for the existing managed profile; physical ownership is
 * shared with ordinary trusted-owner custody without requiring its namespace. */
export class ManagedWriterFence extends PhysicalWriterFence {
 constructor(options:{lock:string;custody:ManagedNativeCustody;publicationGate?:ManagedPublicationGate}){super(options);}
 override beginWriter(writerClass:string){if(writerClass!=='platform'&&writerClass!=='native')throw new BackupError('writers_unknown','Unrestricted writer denied by managed profile');return super.beginWriter(writerClass);}
}
