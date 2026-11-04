import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {BackupError} from './backup.js';
import type {AccountRecoveryCoordinator} from './account-recovery.js';
import {durableJson,privateDir,readJson,restoreFail,restoreLock,sha,exists} from './restore-files.js';

type AccountView=Awaited<ReturnType<AccountRecoveryCoordinator['operate']>>;
interface Collection {
 schema:1;id:string;state:'preparing'|'staged'|'publishing'|'partial'|'completed'|'cancelled';
 selections:{scope:string;jobIds:string[]}[];mode:'missing-only'|'replace';
 accounts:AccountView[];review?:{scope:string;id:string;revision:number;digest?:string}[];digest?:string;errorCode?:string;cancelRequested?:boolean;
}
const complete=(view:AccountView)=>['completed','completed-after-cancel'].includes(view.state);
/** One owner confirmation across enrolled accounts. Each durable child retains
 * the existing native restore, pinning and crash recovery implementation. */
export class PersonalRecoveryCollection {
 readonly root:string;
 constructor(private options:{onAccountCommitted?:(scope:string)=>Promise<void>;root:string;accounts:AccountRecoveryCoordinator;authorize:(actor:string,scope:string,manage:boolean)=>Promise<boolean>}){this.root=resolve(options.root);}
 private path(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw restoreFail('invalid_operation');return join(this.root,id+'.json');}
 private save(value:Collection){return durableJson(this.path(value.id),value);}
 private digest(value:Collection){return sha(JSON.stringify({selections:value.selections,mode:value.mode,accounts:value.review??value.accounts.map(a=>({scope:a.scope,id:a.id,revision:a.revision,digest:a.digest}))}));}
 private async allowed(actor:string,value:Collection){for(const selection of value.selections)if(!await this.options.authorize(actor,selection.scope,true))throw restoreFail('forbidden');}
 async status(actor:string){
  await privateDir(this.root,true);const result:Collection[]=[];
  for(const name of await readdir(this.root)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const value:Collection=await readJson(join(this.root,name));try{await this.allowed(actor,value);result.push(value);}catch(error){if(!(error instanceof BackupError)||error.code!=='forbidden')throw error;}}
  return result;
 }
 async preview(actor:string,input:{selections:{scope:string;jobIds:string[]}[];mode?:'missing-only'|'replace'}){
  if(!Array.isArray(input.selections)||!input.selections.length||input.selections.length>256||input.selections.some(s=>!s||typeof s.scope!=='string'||!Array.isArray(s.jobIds))||new Set(input.selections.map(s=>s.scope)).size!==input.selections.length||input.mode!==undefined&&!['missing-only','replace'].includes(input.mode))throw restoreFail('invalid_collection');
  const value:Collection={schema:1,id:randomUUID(),state:'preparing',selections:structuredClone(input.selections),mode:input.mode??'missing-only',accounts:[]};await this.allowed(actor,value);
  return restoreLock(this.root,async()=>{
   await this.save(value);
   try{
    for(const selection of value.selections){
     const requested=await this.options.accounts.request(actor,selection.scope,{jobIds:selection.jobIds,mode:value.mode});
     value.accounts.push(requested);await this.save(value);
     value.accounts[value.accounts.length-1]=await this.options.accounts.operate(actor,requested.id,{action:'plan',revision:requested.revision});await this.save(value);
    }
    value.state='staged';value.review=value.accounts.map(a=>({scope:a.scope,id:a.id,revision:a.revision,digest:a.digest}));value.digest=this.digest(value);await this.save(value);return value;
   }catch(error){value.state='partial';value.errorCode=error instanceof BackupError?error.code:'collection_preview_failed';await this.save(value);throw error;}
  });
 }
 async confirm(actor:string,id:string,digest:string){
  return restoreLock(this.root,async()=>{
   const value:Collection=await readJson(this.path(id));await this.allowed(actor,value);
   if(!value.digest||value.digest!==digest||value.digest!==this.digest(value))throw restoreFail('stale_approval');
   if(value.state==='completed')return value;
   if(await exists(join(this.root,id+'.cancel')))throw restoreFail('operation_cancelled');
   if(value.accounts.length!==value.selections.length||value.accounts.some(a=>'blocked' in a&&a.blocked))throw restoreFail('account_scope_incomplete');
   value.state='publishing';await this.save(value);
   for(let index=0;index<value.accounts.length;index++){
    if(await exists(join(this.root,id+'.cancel'))){value.cancelRequested=true;break;}
    let account=value.accounts[index];if(complete(account))continue;
    try{
     await this.allowed(actor,value);
     const current=(await this.options.accounts.status(actor,account.scope)).find(item=>item.id===account.id);
     if(!current)throw restoreFail('collection_child_changed');
     if(current.revision===account.revision&&current.digest===account.digest){account=current;value.accounts[index]=account;await this.save(value);}
     else if(!(index>0&&value.mode==='missing-only'&&account.state==='staged'))throw restoreFail('collection_child_changed');
     if(complete(account))continue;
     if(index>0&&value.mode==='missing-only'&&account.state==='staged'){
      const previous=value.accounts[index-1];if(!complete(previous))throw restoreFail('collection_predecessor_incomplete');
      account=await this.options.accounts.refreshForCollection(actor,account.id,{revision:account.revision,digest:account.digest!,precedingId:previous.id,precedingDigest:previous.digest!});
      value.accounts[index]=account;await this.save(value);
     }
     const committed=await this.options.accounts.operate(actor,account.id,{action:'confirm',revision:account.revision,digest:account.digest});
     await this.options.onAccountCommitted?.(account.scope);value.accounts[index]=committed;
     await this.save(value);if(!complete(value.accounts[index]))break;
    }catch(error){value.errorCode=error instanceof BackupError?error.code:'collection_restore_failed';break;}
   }
   value.state=value.accounts.every(complete)?'completed':'partial';if(value.state==='completed')delete value.errorCode;
   await this.save(value);return value;
  });
 }
 async cancel(actor:string,id:string){
  const value:Collection=await readJson(this.path(id));await this.allowed(actor,value);await durableJson(join(this.root,id+'.cancel'),{requested:true});
  // The publication loop observes this marker between children; a child already
  // committing finishes through its ordinary durable publication protocol.
  try{return await restoreLock(this.root,async()=>{const current:Collection=await readJson(this.path(id));current.cancelRequested=true;for(const account of current.accounts)if(!complete(account))await this.options.accounts.operate(actor,account.id,{action:'cancel',revision:account.revision});current.state=current.accounts.some(complete)?'partial':'cancelled';await this.save(current);return current;});}
  catch(error){if(error instanceof BackupError&&error.code==='operation_active')return {...value,cancelRequested:true};throw error;}
 }
}
