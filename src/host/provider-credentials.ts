import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodexAppServer,type Obj} from './codex/rpc.js';
import type {ProviderOperation} from './provider-http-broker.js';

export type ManagedProviderApi='openai-completions'|'openai-responses'|'openai-codex-responses';
export interface ProviderCredentialConfig {
 schema:1;serviceUid:number;sourceUid:number;socket:string;provider:string;models:string[];api:ManagedProviderApi;baseUrl:string;
 auth:{kind:'pi';authPath:string;modelsPath:string}|{kind:'codex';home:string;cli:string;version:'0.159.1';mode:'api-key'|'chatgpt'|'custom-env';envKey?:string;refreshUrl?:string};
}
const refuse=()=>Error('Managed provider credentials unavailable');
export async function readPrivateProviderJson(path:string):Promise<unknown>{
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o022)||stat.size>1024*1024||await realpath(path)!==resolve(path))throw refuse();
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=await file.stat();if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw refuse();return JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw refuse();return value as Record<string,unknown>;}
function url(value:string){const parsed=new URL(value);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw refuse();return parsed.toString().replace(/\/+$/,'');}
function jwt(token:string){try{const parts=token.split('.');if(parts.length!==3)throw refuse();return object(JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')));}catch{throw refuse();}}
function account(token:string){const value=object(jwt(token)['https://api.openai.com/auth']).chatgpt_account_id;if(typeof value!=='string'||!value||value.includes('\r')||value.includes('\n'))throw refuse();return value;}
function headers(values:Record<string,string|undefined>){const result=new Headers();for(const [name,value]of Object.entries(values))if(value!==undefined)result.set(name,value);return Object.fromEntries(result);}
export function validateProviderCredentialConfig(value:unknown):ProviderCredentialConfig{
 const input=object(value),auth=object(input.auth),config=input as unknown as ProviderCredentialConfig;
 if(Object.keys(input).some(key=>!['schema','serviceUid','sourceUid','socket','provider','models','api','baseUrl','auth'].includes(key))||config.schema!==1||!Number.isSafeInteger(config.serviceUid)||config.serviceUid<1||!Number.isSafeInteger(config.sourceUid)||config.sourceUid<1||typeof config.socket!=='string'||resolve(config.socket)!==config.socket||!/^[-A-Za-z0-9_]{1,80}$/.test(config.provider)||!Array.isArray(config.models)||!config.models.length||config.models.length>256||config.models.some(model=>typeof model!=='string'||!model||model.length>200)||new Set(config.models).size!==config.models.length||!['openai-completions','openai-responses','openai-codex-responses'].includes(config.api)||typeof config.baseUrl!=='string')throw refuse();url(config.baseUrl);
 if(auth.kind==='pi'){if(Object.keys(auth).some(key=>!['kind','authPath','modelsPath'].includes(key))||[auth.authPath,auth.modelsPath].some(path=>typeof path!=='string'||resolve(path)!==path))throw refuse();}
 else if(auth.kind==='codex'){if(Object.keys(auth).some(key=>!['kind','home','cli','version','mode','envKey','refreshUrl'].includes(key))||[auth.home,auth.cli].some(path=>typeof path!=='string'||resolve(path)!==path)||auth.version!=='0.159.1'||!['api-key','chatgpt','custom-env'].includes(String(auth.mode))||config.api!=='openai-responses'||auth.mode==='custom-env'&&(typeof auth.envKey!=='string'||!/^[_A-Za-z][_A-Za-z0-9]*$/.test(auth.envKey)))throw refuse();if(auth.refreshUrl!==undefined){if(typeof auth.refreshUrl!=='string')throw refuse();url(auth.refreshUrl);}}
 else throw refuse();return config;
}
/** Model-data requests alone choose an allowlisted model. URLs, actor, provider
 * and credential roots are installed service configuration, never HTTP input. */
export class ProviderCredentialGrant {
 readonly operations:ProviderOperation[];private pending:Promise<unknown>=Promise.resolve();
 constructor(readonly config:ProviderCredentialConfig){
  validateProviderCredentialConfig(config);const suffix=config.api==='openai-completions'?'/chat/completions':config.api==='openai-codex-responses'?'/codex/responses':'/responses',base=url(config.baseUrl),upstream=config.api==='openai-codex-responses'&&base.endsWith('/codex')?base+'/responses':config.api==='openai-codex-responses'&&base.endsWith('/codex/responses')?base:base+suffix;
  this.operations=[{method:'POST',path:'/v1'+suffix,upstream}];
 }
 async credentials(request:{body:Buffer}):Promise<Record<string,string>>{
  const body=object(JSON.parse(request.body.toString('utf8')));if(typeof body.model!=='string'||!this.config.models.includes(body.model))throw refuse();
  const run=this.pending.catch(()=>undefined).then(()=>this.config.auth.kind==='pi'?this.pi(body.model as string):this.codex());this.pending=run;return run;
 }
 async publicCatalog(){
  const auth=this.config.auth;if(auth.kind!=='pi')throw refuse();await readPrivateProviderJson(auth.modelsPath);const runtime=await ModelRuntime.create({authPath:auth.authPath,modelsPath:auth.modelsPath,allowModelNetwork:false,refreshOnCreate:false});
  const models=this.config.models.map(id=>{const model=runtime.getModel(this.config.provider,id);if(!model||model.api!==this.config.api||url(model.baseUrl)!==url(this.config.baseUrl))throw refuse();return {id:model.id,name:model.name,reasoning:model.reasoning,input:model.input.filter(value=>value==='text'||value==='image'),cost:{input:model.cost.input,output:model.cost.output,cacheRead:model.cost.cacheRead,cacheWrite:model.cost.cacheWrite},contextWindow:model.contextWindow,maxTokens:model.maxTokens,...(model.compat?{compat:Object.fromEntries(Object.entries(model.compat).filter(([key,value])=>/^(supports|requires|disable)[A-Z]/.test(key)&&typeof value==='boolean'))}:{})};});
  return {schema:1,provider:this.config.provider,api:this.config.api,models};
 }
 private async pi(modelId:string){
  const auth=this.config.auth;if(auth.kind!=='pi')throw refuse();await readPrivateProviderJson(auth.authPath);await readPrivateProviderJson(auth.modelsPath);
  const runtime=await ModelRuntime.create({authPath:auth.authPath,modelsPath:auth.modelsPath,allowModelNetwork:false,refreshOnCreate:false}),model=runtime.getModel(this.config.provider,modelId);if(!model||model.api!==this.config.api||url(model.baseUrl)!==url(this.config.baseUrl))throw refuse();
  const resolved=await runtime.getAuth(model,{signal:AbortSignal.timeout(30000),minOAuthValidityMs:60000});if(!resolved||resolved.auth.baseUrl&&url(resolved.auth.baseUrl)!==url(this.config.baseUrl))throw refuse();
  const result=new Headers();for(const source of [model.headers,resolved.auth.headers])for(const [name,value]of Object.entries(source??{})){if(value===null)result.delete(name);else result.set(name,value);}if(resolved.auth.apiKey&&!result.has('authorization'))result.set('authorization','Bearer '+resolved.auth.apiKey);if(!result.has('authorization')&&!result.has('cf-aig-authorization'))throw refuse();
  if(model.api==='openai-codex-responses'){if(!resolved.auth.apiKey)throw refuse();result.set('authorization','Bearer '+resolved.auth.apiKey);result.set('chatgpt-account-id',account(resolved.auth.apiKey));result.set('openai-beta','responses=experimental');}
  return Object.fromEntries(result);
 }
 private async codex(){
  const auth=this.config.auth;if(auth.kind!=='codex')throw refuse();const home=await lstat(auth.home);if(!home.isDirectory()||home.isSymbolicLink()||home.uid!==process.getuid?.()||(home.mode&0o077)||await realpath(auth.home)!==auth.home||await realpath(auth.cli)!==auth.cli)throw refuse();
  const env:Record<string,string>={HOME:auth.home,CODEX_HOME:auth.home,PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'C.UTF-8'};if(auth.mode==='custom-env'){const value=process.env[auth.envKey!];if(!value)throw refuse();env[auth.envKey!]=value;}if(auth.refreshUrl)env.CODEX_REFRESH_TOKEN_URL_OVERRIDE=auth.refreshUrl;
  const version=await promisify(execFile)(auth.cli,['--version'],{env,timeout:5000,maxBuffer:1024});if(!/\b0\.159\.1\b/.test(version.stdout))throw refuse();
  const native=new CodexAppServer({cliPath:auth.cli,args:['app-server','-c','cli_auth_credentials_store="file"'],cwd:auth.home,env});
  try{
   await native.start('pi_coffee_provider_auth','1');const response=await native.request('config/read',{includeLayers:false,cwd:auth.home},10000) as Obj,config=object(response.config),provider=config.model_provider??'openai';if(provider!==this.config.provider)throw refuse();
   const providers=config.model_providers===undefined?{}:object(config.model_providers),entry=providers[this.config.provider]===undefined?{}:object(providers[this.config.provider]);
   const base=typeof entry.base_url==='string'?entry.base_url:auth.mode==='chatgpt'?'https://chatgpt.com/backend-api/codex':'https://api.openai.com/v1';if(url(base)!==url(this.config.baseUrl)||entry.wire_api!=null&&entry.wire_api!=='responses')throw refuse();
   const current=auth.mode==='custom-env'?undefined:object(await readPrivateProviderJson(join(auth.home,'auth.json')));
   const staticHeaders:Record<string,string>={};if(entry.http_headers!=null)for(const [name,value]of Object.entries(object(entry.http_headers))){if(typeof value!=='string')throw refuse();staticHeaders[name]=value;}
   if(entry.env_http_headers!=null)throw refuse(); // Not resolved silently from ambient service state.
   if(auth.mode==='custom-env'){if(entry.env_key!==auth.envKey||entry.requires_openai_auth!==false)throw refuse();return headers({authorization:'Bearer '+env[auth.envKey!],...staticHeaders});}
   if(auth.mode==='api-key'){if(current!.auth_mode!==undefined&&current!.auth_mode!=='apikey'||typeof current!.OPENAI_API_KEY!=='string'||!current!.OPENAI_API_KEY)throw refuse();return headers({authorization:'Bearer '+current!.OPENAI_API_KEY,...staticHeaders});}
   if(current!.auth_mode!==undefined&&current!.auth_mode!=='chatgpt'||current!.OPENAI_API_KEY)throw refuse();const tokens=object(current!.tokens);if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string'||typeof tokens.id_token!=='string')throw refuse();const expiry=jwt(tokens.access_token).exp,refresh=typeof expiry!=='number'||expiry*1000<Date.now()+60000;
   const status=await native.request('getAuthStatus',{includeToken:true,refreshToken:refresh},30000) as Obj;if(typeof status.authToken!=='string'||!status.authToken)throw refuse();const renewed=jwt(status.authToken),expiration=renewed.exp;if(typeof expiration!=='number'||expiration*1000<Date.now()+30000)throw refuse();
   const latest=object(await readPrivateProviderJson(join(auth.home,'auth.json'))),latestTokens=object(latest.tokens);if(latestTokens.access_token!==status.authToken||typeof latestTokens.account_id!=='string'||latestTokens.account_id!==account(status.authToken))throw refuse();
   return headers({authorization:'Bearer '+status.authToken,'chatgpt-account-id':latestTokens.account_id,...staticHeaders});
  }finally{await native.stop();}
 }
}
