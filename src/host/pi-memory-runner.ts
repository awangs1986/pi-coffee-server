import {memoryExtractionInstructions} from 'pi-coffee-mishu/host-policy';
import {RpcClient,SessionManager} from '@earendil-works/pi-coding-agent';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';

export interface PiMemoryExtractionOptions {
 cliPath?:string;agentDir?:string;cwd:string;provider:string;model:string;
 sessionFile:string;prompt:string;signal:AbortSignal;env?:Record<string,string>;
 /** Only the reviewed provider registration, never normal session extensions. */
 providerExtension?:string;
}
export interface MemoryExtractionOutput {
 text:string;provider:string;model:string;recovered:boolean;
 usage?:{input:number;output:number;cacheRead:number;cacheWrite:number};
}
export class MemoryExtractionFailure extends Error {
 constructor(readonly output:MemoryExtractionOutput){super('Native memory extraction outcome uncertain; known usage retained');}
}
function interruptedUsage(file:string,provider:string,model:string):MemoryExtractionOutput|undefined {
 const message=SessionManager.open(file).buildSessionContext().messages.filter(m=>m.role==='assistant').at(-1);
 if(message?.role!=='assistant'||message.provider!==provider||message.model!==model||![message.usage?.input,message.usage?.output,message.usage?.cacheRead,message.usage?.cacheWrite].some(n=>typeof n==='number'&&n>0))return;
 return {text:'',provider,model,recovered:false,usage:{input:message.usage.input,output:message.usage.output,cacheRead:message.usage.cacheRead,cacheWrite:message.usage.cacheWrite}};
}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
async function privateDirectory(path:string){await mkdir(path,{recursive:true,mode:0o700});let current=resolve(path);for(;;){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Native memory extraction directory must not contain symlinks');const parent=dirname(current);if(parent===current)break;current=parent;}}
const safeFile=async(path:string)=>{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024*1024)throw Error('Memory extraction output unavailable');return readFile(path,'utf8');};
function completed(file:string,provider:string,model:string):MemoryExtractionOutput|undefined {
 const messages=SessionManager.open(file).buildSessionContext().messages;
 const message=messages.at(-1);
 if(message?.role!=='assistant'||message.stopReason!=='stop'||message.provider!==provider||message.model!==model||message.content.some(p=>p.type==='toolCall'))return;
 const text=message.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
 if(!text.trim()||text.length>32000)return;
 return {text,provider,model,recovered:true,usage:message.usage&&[message.usage.input,message.usage.output,message.usage.cacheRead,message.usage.cacheWrite].some(n=>n>0)?{input:message.usage.input,output:message.usage.output,cacheRead:message.usage.cacheRead,cacheWrite:message.usage.cacheWrite}:undefined};
}
/** A separate native Pi session. No source history, permissions, tools or resource discovery. */
export async function runPiMemoryExtraction(options:PiMemoryExtractionOptions):Promise<MemoryExtractionOutput>{
 if(options.signal.aborted)throw Error('Memory extraction cancelled before admission');
 if(!options.prompt||options.prompt.length>48000)throw Error('Memory extraction input exceeds capacity');
 const fingerprint=digest(JSON.stringify([options.provider,options.model,options.prompt]));
 const attempt=options.sessionFile+'.attempt.json',output=options.sessionFile+'.result.json';
 await privateDirectory(dirname(options.sessionFile));await privateDirectory(options.cwd);
 try{
  const prior=JSON.parse(await safeFile(attempt));
  if(prior.version!==1||prior.fingerprint!==fingerprint)throw Error('Memory extraction identity conflict');
  try{const result=JSON.parse(await safeFile(output));if(result.fingerprint===fingerprint&&result.value?.text)return {...result.value,recovered:true};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const native=await lstat(options.sessionFile).catch(()=>undefined);
  if(native?.isFile()&&!native.isSymbolicLink()&&native.nlink===1&&native.size<1024*1024){if(!prior.nativeId||SessionManager.open(options.sessionFile).getHeader()?.id!==prior.nativeId)throw Error('Memory extraction native identity conflict');const value=completed(options.sessionFile,options.provider,options.model);if(value)return value;}
  throw Error('Memory extraction outcome uncertain; no model generation was repeated');
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 // First-use files are exclusive; a preseeded thread is never resumed as an extraction.
 const header=SessionManager.create(options.cwd,dirname(options.sessionFile)).getHeader();
 await writeFile(options.sessionFile,JSON.stringify(header)+'\n',{flag:'wx',mode:0o600,flush:true});
 // Local settings belong to this isolated directory. Native RPC setters persist
 // global profile settings, so they must never be used for an auxiliary run.
 const settingsDir=join(options.cwd,'.pi');await privateDirectory(settingsDir);
 const settings=JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}),settingsFile=join(settingsDir,'settings.json');
 try{await writeFile(settingsFile,settings,{flag:'wx',mode:0o600,flush:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await safeFile(settingsFile)!==settings)throw Error('Isolated native settings conflict');}
 // Exclusive durable intent precedes the first provider call. A crash never grants a new attempt.
 await writeFile(attempt,JSON.stringify({version:1,fingerprint,nativeId:header?.id}),{flag:'wx',mode:0o600,flush:true});
 const env:Record<string,string|undefined>={...options.env,ANTIGRAVITY_NO_EXTRA_TOOLS:'1'};
 for(const key of new Set([...Object.keys(process.env),...Object.keys(options.env??{})]))if(key.startsWith('PI_COFFEE_')||key==='SERPER_API_KEY'||key==='PI_SUBAGENT_PI_BINARY')env[key]=undefined;
 if(options.agentDir)env.PI_CODING_AGENT_DIR=options.agentDir;
 const args=['--offline','--approve','--no-tools','--no-extensions','--no-mcp','--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--session',options.sessionFile,'--system-prompt',memoryExtractionInstructions];
 if(options.providerExtension)args.push('--extension',options.providerExtension);
 const client=new RpcClient({cliPath:options.cliPath??join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),'bundle','cli.js'),cwd:options.cwd,provider:options.provider,model:options.model,args,env:env as Record<string,string>});
 let unsubscribe=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
 const abort=()=>{void client.abort().catch(()=>undefined);};options.signal.addEventListener('abort',abort,{once:true});
 try{
  await client.start();
  const state=await client.getState();if(state.autoCompactionEnabled!==false||(await client.getMessages()).some(m=>m.role==='user'||m.role==='assistant'||m.role==='toolResult'||m.role==='custom'))throw Error('Native extraction isolation not configured');if(state.model?.provider!==options.provider||state.model.id!==options.model)throw Error('Selected native model unavailable; no substitute allowed');
  const settled=new Promise<void>((resolve,reject)=>{
   timer=setTimeout(()=>{abort();reject(Error('Memory extraction outcome uncertain; native timeout'));},90000);timer.unref();
   unsubscribe=client.onEvent(event=>{if(event.type==='tool_execution_start'){abort();reject(Error('Native memory extraction attempted a forbidden tool'));}if(event.type==='agent_settled')resolve();});
  });
  // Attach a handler before prompt admission can fail, avoiding a detached rejection.
  void settled.catch(()=>undefined);
  if(options.signal.aborted)throw Error('Memory extraction cancelled');
  const disposition=await client.prompt(options.prompt);if(disposition!=='started')throw Error('Native extraction was not admitted');
  await settled;
  const value=completed(options.sessionFile,options.provider,options.model);if(!value)throw Error('Native extraction output uncertain; no candidates committed');
  value.recovered=false;
  const temp=output+'.tmp';await writeFile(temp,JSON.stringify({fingerprint,value}),{mode:0o600,flush:true});await rename(temp,output);
  return value;
 }catch(error){
  const file=await lstat(options.sessionFile).catch(()=>undefined);
  if(file?.isFile()&&!file.isSymbolicLink()&&file.size<1024*1024){const output=interruptedUsage(options.sessionFile,options.provider,options.model);if(output)throw new MemoryExtractionFailure(output);}
  throw error;
 }finally{if(timer)clearTimeout(timer);unsubscribe();options.signal.removeEventListener('abort',abort);await client.stop();}
}
