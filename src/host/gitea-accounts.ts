import {readFile} from 'node:fs/promises';
import {normalizeUsername} from '../shared/identity.js';

export interface GiteaAccount {
 userId?:number; login:string; token:string; gitName?:string; gitEmail?:string;
}

/** Administrator-owned binding; an HTTP caller never selects a credential file. */
export async function giteaAccountForScope(file:string|undefined,user:string|undefined,legacy?:GiteaAccount):Promise<GiteaAccount|undefined>{
 if(!file)return user===undefined?legacy:undefined;
 let state:any;
 try{state=JSON.parse(await readFile(file,'utf8'));}catch{throw new Error('Gitea account configuration is unavailable');}
 if(state?.version!==1||!state.accounts||typeof state.accounts!=='object'||Array.isArray(state.accounts))throw new Error('Invalid Gitea account configuration');
 const key=user??'default';
 if(!Object.hasOwn(state.accounts,key))return user===undefined?legacy:undefined;
 const account=state.accounts[key];
 if(!account||!Number.isSafeInteger(account.userId)||account.userId<=0||typeof account.login!=='string'||normalizeUsername(account.login)!==account.login||typeof account.token!=='string'||!account.token||/[\s\x00-\x1f\x7f]/.test(account.token))throw new Error('Invalid Gitea account binding');
 if(user!==undefined && (/^gitea-[1-9][0-9]*$/.test(user)?String(account.userId)!==user.slice(6):account.login!==user))throw new Error('Gitea account does not match the authenticated scope');
 if(account.gitName!==undefined&&(typeof account.gitName!=='string'||!account.gitName.trim()||/[\r\n\x00]/.test(account.gitName)))throw new Error('Invalid Gitea Git author name');
 if(typeof account.gitEmail!=='string'||!/^[^\s<>@]+@[^\s<>@]+$/.test(account.gitEmail))throw new Error('Configure this Gitea account’s Git author email');
 return {userId:account.userId,login:account.login,token:account.token,gitName:account.gitName,gitEmail:account.gitEmail};
}
