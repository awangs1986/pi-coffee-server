import {AsyncLocalStorage} from 'node:async_hooks';
import {LEGACY_BACKUP_SCOPE} from './backup.js';

/** Established only by authenticated Host transport or the private maintenance
 * boundary. Never retained as a login-to-scope grant between requests. */
const requests=new AsyncLocalStorage<Readonly<{actor:string|undefined;ownScope:string}>>();
export function withBackupRequestIdentity<T>(actor:string|undefined,ownScope:string,run:()=>T):T{return requests.run(Object.freeze({actor,ownScope}),run);}
export function authorizeRecoveryRequest(actor:string,scope:string,manage:boolean,managedScopes:readonly string[],administrator='awangs'):boolean{
 const current=requests.getStore();if(!current?.actor||actor!==current.actor)return false;
 if(actor===administrator)return scope===current.ownScope||scope===LEGACY_BACKUP_SCOPE||managedScopes.includes(scope);
 return !manage&&scope===current.ownScope;
}
