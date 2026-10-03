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
interface StoredAccount extends GitHubAccount {token:string;}
/** Private Host-owned credentials; callers receive metadata, never bearer tokens. */
export class GitHubAccounts {
  private tail:Promise<unknown>=Promise.resolve();
  private readonly environments=new Map<string,Promise<Record<string,string>>>();
  readonly file:string;
  constructor(readonly root:string,readonly options:{apiUrl?:string;gitea?:{url:string;token:string;owner:string}}={}){this.file=join(root,'accounts.json');}
  private async read():Promise<StoredAccount[]>{
    try {const state=JSON.parse(await readFile(this.file,'utf8'));if(state.version!==1||!Array.isArray(state.accounts))throw Error();return state.accounts;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('GitHub authorization store is unavailable');}
  }
  private async write(accounts:StoredAccount[]){await mkdir(this.root,{recursive:true,mode:0o700});const temp=this.file+'.'+randomUUID();await writeFile(temp,JSON.stringify({version:1,accounts}),{mode:0o600});await rename(temp,this.file);}
  private metadata({token:_,...account}:StoredAccount):GitHubAccount{return account;}
  async list(){await this.tail;return (await this.read()).map(a=>this.metadata(a));}
  async client(id:unknown){const account=await this.resolve(id);return new GitHubClient({token:account.token,apiUrl:this.options.apiUrl});}
  private async resolve(id:unknown){await this.tail;const account=(await this.read()).find(a=>a.id===id);if(!account)throw new Error('Select a connected GitHub account; authorization is missing or disconnected');return account;}
  async environment(id:unknown,ghProgram?:string):Promise<Record<string,string>> {
    const key=JSON.stringify([id??null,ghProgram??null]);let pending=this.environments.get(key);
    if(!pending){pending=this.prepareEnvironment(id,ghProgram);this.environments.set(key,pending);pending.catch(()=>this.environments.delete(key));}
    return {...await pending};
  }
  private async prepareEnvironment(id:unknown,ghProgram?:string):Promise<Record<string,string>> {
    if(id!==undefined&&(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)))throw new Error('Invalid GitHub authorization');
    const bin=join(this.root,'tools',id??'unbound'),config=join(bin,'config');
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
      if(input.action!=='bind'||typeof input.token!=='string'||!input.token||/\s/.test(input.token)||input.token.length>4096)throw new Error('Invalid GitHub account operation');
      const identity=await new GitHubClient({token:input.token,apiUrl:this.options.apiUrl}).identity();
      let account=accounts.find(a=>a.githubId===identity.githubId);
      if(account){account.token=input.token;account.login=identity.login;}
      else {account={...identity,id:'github-'+identity.githubId,token:input.token,connectedAt:new Date().toISOString()};accounts.push(account);}
      await this.write(accounts);return {account:this.metadata(account)};
    });this.tail=run.catch(()=>undefined);return run;
  }
}
