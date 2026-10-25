import {BackupError} from './backup.js';

/** Create before constructing any native factories. Every unrestricted launch
 * must retain its admission through the concrete complete native lifetime. */
export class ManagedLaunchPolicy {
 private mode:'legacy'|'draining'|'protected-only'='legacy';private legacy=0;private unknown=false;private revision=0;
 assertLegacyAllowed(){if(this.mode!=='legacy')throw new BackupError('writers_active','Protected enrollment denies new unrestricted launches');}
 markUnknown(){this.unknown=true;this.revision++;}
 beginLegacyLifetime(){if(this.mode!=='legacy')throw new BackupError('writers_active','Protected enrollment denies new unrestricted launches');this.legacy++;this.revision++;let released=false;return {naturalExit:()=>{if(!released){released=true;this.legacy--;this.revision++;}},lostCustody:()=>{if(!released){released=true;this.legacy--;this.unknown=true;this.revision++;}}};}
 requestProtectedOnly(){if(this.mode==='legacy'){this.mode='draining';this.revision++;}if(this.legacy===0&&!this.unknown&&this.mode==='draining'){this.mode='protected-only';this.revision++;}return this.status();}
 status(){return {admission:this.mode,legacy:this.unknown?'unknown':this.legacy?'active':'drained',activeLegacy:this.legacy,revision:this.revision} as const;}
 assertProtectedOnly(){const state=this.requestProtectedOnly();if(state.admission!=='protected-only'||state.legacy!=='drained')throw new BackupError('writers_unknown','Legacy native population has not naturally drained');return state;}
}
