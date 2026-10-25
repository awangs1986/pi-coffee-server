import {randomUUID} from 'node:crypto';import {readdir} from 'node:fs/promises';import {join,resolve} from 'node:path';import {normalizeUsername} from '../shared/identity.js';import {LEGACY_BACKUP_SCOPE} from './backup.js';import type {RestoreCoordinator,RestoreScope,RestoreMaterialSource} from './restore.js';import {durableJson,privateDir,readJson,restoreFail,restoreLock} from './restore-files.js';
const identifier=/^[0-9a-f]{8}-[0-9a-f-]{27}$/;const scopeValid=(scope:string)=>scope===LEGACY_BACKUP_SCOPE||normalizeUsername(scope)===scope;
export interface AccountRecoveryOperation {schemaVersion:1;id:string;scope:string;requestedBy:string;revision:number;createdAt:string;updatedAt:string;state:'requested'|'staged'|'approved'|'publishing'|'partial'|'completed'|'cancelled';mode:'missing-only'|'replace';jobIds:string[];digest?:string;}
export interface AccountRecoveryOptions {root:string;restore:Pick<RestoreCoordinator,'request'|'operate'|'status'>;scope:(scope:string)=>Promise<RestoreScope>;authorize:(actor:string,scope:string,manage:boolean)=>Promise<boolean>;materialSource?:(actor:string,scope:string)=>Promise<RestoreMaterialSource>;now?:()=>number;}
/** A scoped durable parent operation. Native material/publication remains behind
 * the independently approved child restore seam; no Browser path or key root. */
export class AccountRecoveryCoordinator {
 readonly root:string;constructor(private options:AccountRecoveryOptions){this.root=resolve(options.root);}
 private date(){return new Date((this.options.now??Date.now)()).toISOString();}
 private async allowed(actor:string,scope:string,manage:boolean){if(!scopeValid(scope)||!await this.options.authorize(actor,scope,manage))throw restoreFail('forbidden');}
 private path(id:string){if(!identifier.test(id))throw restoreFail('invalid_operation');return join(this.root,id+'.json');}
 private async read(id:string):Promise<AccountRecoveryOperation>{return readJson(this.path(id));}
 private async save(operation:AccountRecoveryOperation){operation.updatedAt=this.date();await durableJson(this.path(operation.id),operation);}
 private public(operation:AccountRecoveryOperation){return {...operation,protectionScope:['pi','codex'],excludedEngines:['claude','cursor','grok'],authenticationRestored:false,automaticReplay:false};}
 async status(actor:string,scope:string){await this.allowed(actor,scope,false);await privateDir(this.root,true);const result=[];for(const name of await readdir(this.root)){if(!identifier.test(name.slice(0,-5))||!name.endsWith('.json'))continue;const operation=await this.read(name.slice(0,-5));if(operation.scope===scope)result.push(this.public(operation));}return result;}
 async request(actor:string,scope:string,input:{jobIds:string[];mode?:'missing-only'|'replace'}){
  await this.allowed(actor,scope,false);if(!input||Object.keys(input).some(key=>!['jobIds','mode'].includes(key))||!Array.isArray(input.jobIds)||input.jobIds.length<1||input.jobIds.length>100||input.jobIds.some(id=>typeof id!=='string'||!identifier.test(id))||new Set(input.jobIds).size!==input.jobIds.length||input.mode!==undefined&&!['missing-only','replace'].includes(input.mode))throw restoreFail('invalid_account_selection');
  return restoreLock(this.root,async()=>{const operation:AccountRecoveryOperation={schemaVersion:1,id:randomUUID(),scope,requestedBy:actor,revision:1,createdAt:this.date(),updatedAt:this.date(),state:'requested',mode:input.mode??'missing-only',jobIds:[...input.jobIds]};await this.save(operation);return this.public(operation);});
 }
 async operate(actor:string,id:string,input:{action:'plan'|'approve'|'publish'|'cancel'|'revise';revision:number;digest?:string}){
  return restoreLock(this.root,async()=>{const operation=await this.read(id);await this.allowed(actor,operation.scope,input.action!=='cancel');if(!Number.isSafeInteger(input.revision)||input.revision!==operation.revision)throw restoreFail('stale_revision');
   if(input.action==='cancel'){if(operation.state==='completed')return this.public(operation);operation.state='cancelled';await this.save(operation);return this.public(operation);}
   throw restoreFail('account_operation_not_ready');
  });
 }
}
