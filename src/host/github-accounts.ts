import {GitHubCredentialBroker} from './github-credential-broker.js';
import {githubSecret,type GitHubCredentials} from '../shared/github-credentials.js';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const quote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
import {GitHubClient} from './github.js';
export interface GitHubAccount {id:string;githubId:string;login:string;connectedAt:string;}
interface StoredAccount extends GitHubAccount,GitHubCredentials {credentialVersion?:string;reconnectRequired?:boolean;}
interface GitHubAccountsOptions {apiUrl?:string;gitea?:{url:string;token:string;owner:string};renew?:(refreshToken:string)=>Promise<GitHubCredentials>;now?:()=>number;}
/** Private Host-owned credentials; callers receive metadata, never bearer tokens. */
export class GitHubAccounts {
  private tail:Promise<unknown>=Promise.resolve();
  private readonly environments=new Map<string,Promise<Record<string,string>>>();
  private readonly renewals=new Map<string,Promise<void>>();
  private readonly retryAfter=new Map<string,number>();
  private broker?:GitHubCredentialBroker;
  private brokerStart?:Promise<void>;
  readonly file:string;
  constructor(readonly root:string,readonly options:GitHubAccountsOptions={}){this.file=join(root,'accounts.json');}
  private async read():Promise<StoredAccount[]>{
    try {const state=JSON.parse(await readFile(this.file,'utf8'));if(state.version!==1||!Array.isArray(state.accounts))throw Error();return state.accounts;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('GitHub authorization store is unavailable');}
  }
  private async write(accounts:StoredAccount[]){await mkdir(this.root,{recursive:true,mode:0o700});const temp=this.file+'.'+randomUUID();await writeFile(temp,JSON.stringify({version:1,accounts}),{mode:0o600});await rename(temp,this.file);}
  private metadata(account:StoredAccount):GitHubAccount{return {id:account.id,githubId:account.githubId,login:account.login,connectedAt:account.connectedAt};}
  async list(){await this.tail;return (await this.read()).map(a=>this.metadata(a));}
  async client(id:unknown){await this.resolve(id);return new GitHubClient({token:()=>this.token(id),apiUrl:this.options.apiUrl});}
  private async resolve(id:unknown){await this.tail;const account=(await this.read()).find(a=>a.id===id);if(!account)throw new Error('Select a connected GitHub account; authorization is missing or disconnected');return account;}
  private now(){return this.options.now?.()??Date.now();}
  private credentials(input:Record<string,unknown>):GitHubCredentials {
    if(!githubSecret(input.token))throw Error('Invalid GitHub credential');
    const result:GitHubCredentials={token:input.token};
    if(input.refreshToken===undefined&&input.expiresAt===undefined&&input.refreshExpiresAt===undefined)return result;
    if(!githubSecret(input.refreshToken)||typeof input.expiresAt!=='number'||!Number.isSafeInteger(input.expiresAt)||typeof input.refreshExpiresAt!=='number'||!Number.isSafeInteger(input.refreshExpiresAt)||input.expiresAt<=this.now()||input.refreshExpiresAt<=this.now())throw Error('Invalid GitHub expiry');
    return {...result,refreshToken:input.refreshToken,expiresAt:input.expiresAt,refreshExpiresAt:input.refreshExpiresAt};
  }
  /** API callers and native helpers share this one refresh owner. */
  async token(id:unknown):Promise<string> {
    const account=await this.resolve(id);
    if(account.reconnectRequired)throw Error('github_reconnect_required');
    if(account.expiresAt===undefined||account.expiresAt>this.now()+60000)return account.token;
    if(!account.refreshToken||!this.options.renew||!account.refreshExpiresAt||account.refreshExpiresAt<=this.now())throw Error('github_reconnect_required');
    const key=account.id+':'+(account.credentialVersion??account.token);
    if((this.retryAfter.get(key)??0)>this.now())throw Error('github_refresh_unavailable');
    let renewal=this.renewals.get(key);
    if(!renewal){renewal=this.refresh(account);this.renewals.set(key,renewal);void renewal.finally(()=>this.renewals.delete(key)).catch(()=>undefined);}
    await renewal;
    const current=await this.resolve(id);
    if(current.reconnectRequired||current.expiresAt!==undefined&&current.expiresAt<=this.now())throw Error('github_reconnect_required');
    return current.token;
  }
  private async refresh(snapshot:StoredAccount){
    let credentials:GitHubCredentials|undefined,reconnect=false;
    try {
      credentials=this.credentials({...await this.options.renew!(snapshot.refreshToken!)});
      if(!credentials.refreshToken)throw Error('github_refresh_unavailable');
      const identity=await new GitHubClient({token:credentials.token,apiUrl:this.options.apiUrl}).identity();
      if(identity.githubId!==snapshot.githubId)throw Error('github_reconnect_required');
    }catch(error){reconnect=error instanceof Error&&error.message==='github_reconnect_required';credentials=undefined;}
    const run=this.tail.then(async()=>{
      const accounts=await this.read(),current=accounts.find(a=>a.id===snapshot.id);
      // A reconnect/delete wins over any older renewal, even the same access token.
      if(!current||current.credentialVersion!==snapshot.credentialVersion||current.token!==snapshot.token)return;
      if(credentials){Object.assign(current,credentials);delete current.reconnectRequired;await this.write(accounts);this.retryAfter.delete(snapshot.id+':'+(snapshot.credentialVersion??snapshot.token));return;}
      if(reconnect){current.reconnectRequired=true;await this.write(accounts);throw Error('github_reconnect_required');}
      this.retryAfter.set(snapshot.id+':'+(snapshot.credentialVersion??snapshot.token),this.now()+30000);throw Error('github_refresh_unavailable');
    });this.tail=run.catch(()=>undefined);await run;
  }
  async close(){await Promise.allSettled([...this.renewals.values()]);await this.tail;await this.broker?.close();}
  async environment(id:unknown,ghProgram?:string):Promise<Record<string,string>> {
    const key=JSON.stringify([id??null,ghProgram??null]);let pending=this.environments.get(key);
    if(!pending){pending=this.prepareEnvironment(id,ghProgram);this.environments.set(key,pending);pending.catch(()=>this.environments.delete(key));}
    return {...await pending};
  }
  private async prepareEnvironment(id:unknown,ghProgram?:string):Promise<Record<string,string>> {
    if(id!==undefined&&(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)))throw new Error('Invalid GitHub authorization');
    const bin=join(this.root,'tools',id??'unbound'),config=join(bin,'config');
    await mkdir(this.root,{recursive:true,mode:0o700});
    if(this.options.renew){
      if(!this.brokerStart){this.broker=new GitHubCredentialBroker(this.root,id=>this.token(id));this.brokerStart=this.broker.start();}
      await this.brokerStart;
    }
    await mkdir(config,{recursive:true,mode:0o700});
    // Git gets a private HOME so ~/.netrc and global helpers cannot silently authenticate.
    const gitProgram=(await exec('/bin/sh',['-c','command -v git'],{env:process.env})).stdout.trim();
    ghProgram??=(await exec('/bin/sh',['-c','command -v gh'],{env:process.env}).catch(()=>({stdout:'/usr/bin/gh'}))).stdout.trim();
    const identity:Record<string,string>={};
    for(const key of ['user.name','user.email']){
      const value=await exec(gitProgram,['config','--global','--get',key]).then(r=>r.stdout.trim()).catch(()=>undefined);
      if(value)identity[key]=value;
    }
    const transport=join(this.root,'transport.json'),temp=transport+'.'+randomUUID();
    await writeFile(temp,JSON.stringify({identity,gitea:this.options.gitea}),{mode:0o600});await rename(temp,transport);
    const script=fileURLToPath(new URL('./github-tools.mjs',import.meta.url));
    for(const [name,program] of [['gh',ghProgram],['git',gitProgram]]){
      const call=[process.execPath,script,name,this.file,id??'',program].map(quote).join(' ');
      const wrapper=join(bin,name),temporary=wrapper+'.'+randomUUID();
      await writeFile(temporary,'#!/bin/sh\nexec '+call+' "$@"\n',{mode:0o700});await rename(temporary,wrapper);
    }
    const helper='!'+[process.execPath,script,'credential',this.file,id??''].map(quote).join(' ');
    const settings=[
      ['credential.helper',''],['credential.helper','!'+[process.execPath,script,'gitea',transport,''].map(quote).join(' ')],
      ['credential.https://github.com.helper',''],['credential.https://github.com.helper',helper],
      ['credential.https://github.com.username','x-access-token'],['credential.https://github.com.useHttpPath','false'],
      ['http.https://github.com/.extraHeader',''],
      ['url.https://github.com/.insteadOf','git@github.com:'],['url.https://github.com/.insteadOf','ssh://git@github.com/'],
      ['url.https://github.com/.insteadOf','ssh://git@github.com:22/'],
    ];
    const env:Record<string,string>={PATH:bin+':'+(process.env.PATH??''),GH_CONFIG_DIR:config,GH_HOST:'github.com',GH_TOKEN:'coffee-no-shared-auth',GITHUB_TOKEN:'coffee-no-shared-auth',GH_ENTERPRISE_TOKEN:'coffee-no-shared-auth',GITHUB_ENTERPRISE_TOKEN:'coffee-no-shared-auth',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false',SSH_ASKPASS:'/bin/false',SSH_AUTH_SOCK:'',GIT_CONFIG_PARAMETERS:'',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:String(settings.length),...Object.fromEntries(settings.flatMap(([key,value],index)=>[['GIT_CONFIG_KEY_'+index,key],['GIT_CONFIG_VALUE_'+index,value]]))};
    const bashEnv=join(bin,'bash-env'),bashTemporary=bashEnv+'.'+randomUUID();
    const exports=Object.entries(env).filter(([key])=>key!=='PATH').map(([key,value])=>'export '+key+'='+quote(value)).join('\n');
    await writeFile(bashTemporary,'export PATH='+quote(bin)+':"${COFFEE_MANAGED_PATH:-}":"$PATH"\n'+exports+'\n',{mode:0o600});await rename(bashTemporary,bashEnv);
    return {...env,BASH_ENV:bashEnv,COFFEE_MANAGED_PATH:env.PATH};
  }
  async handle(input:Record<string,unknown>):Promise<unknown>{
    if(input.action==='list')return {accounts:await this.list()};
    if(input.action==='check'){const client=await this.client(input.id);return {account:await client.identity()};}
    const run=this.tail.then(async()=>{
      const accounts=await this.read();
      if(input.action==='delete'){
        if(!accounts.some(a=>a.id===input.id))throw new Error('Unknown GitHub account');
        await this.write(accounts.filter(a=>a.id!==input.id));return {ok:true};
      }
      if(input.action!=='bind')throw new Error('Invalid GitHub account operation');
      const credentials=this.credentials(input);
      const identity=await new GitHubClient({token:credentials.token,apiUrl:this.options.apiUrl}).identity();
      let account=accounts.find(a=>a.githubId===identity.githubId);
      if(account){delete account.refreshToken;delete account.expiresAt;delete account.refreshExpiresAt;delete account.reconnectRequired;Object.assign(account,credentials,{credentialVersion:randomUUID(),login:identity.login});}
      else {account={...identity,id:'github-'+identity.githubId,...credentials,credentialVersion:randomUUID(),connectedAt:new Date().toISOString()};accounts.push(account);}
      await this.write(accounts);return {account:this.metadata(account)};
    });this.tail=run.catch(()=>undefined);return run;
  }
}
