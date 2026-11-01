import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import type {SpeechState} from '../../packages/completion-speech/index.js';
import type {Workspaces} from './workspaces.js';
/** File storage and authenticated task admission are Coffee responsibilities. */
export function createCompletionSpeech(root:string,workspaces:Workspaces,titles?:()=>Promise<Array<{id:string;name?:string}>>){
 const path=join(root,'state.json');
 const operations=new AsyncLocalStorage<{delivery:boolean;titles?:Promise<Array<{id:string;name?:string}>>}>();
 const operation=<T>(delivery:boolean,work:()=>T)=>operations.run({delivery},work);
 const title=async(id:string)=>{
  const current=operations.getStore();
  if(!current?.delivery)return '未命名对话';
  current.titles??=titles?.()??Promise.resolve([]);
  return (await current.titles).find(task=>task.id===id)?.name||'未命名对话';
 };
 const adapter={
  digest:async(text:string)=>createHash('sha256').update(text).digest('hex'),
  load:async()=>{try{return JSON.parse(await readFile(path,'utf8')) as SpeechState;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}},
  save:async (state:SpeechState)=>{await mkdir(root,{recursive:true,mode:0o700});const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,path);},
  task:async (id:string)=>{const task=await workspaces.lookup(id);if(!task)return;const status=(await workspaces.runStatuses()).get(id);return {id,title:await title(id),engine:task.engine??'pi',archived:Boolean(task.archived||task.workspaceRemoved||task.cleanupStarted),...status};}
 };
 type Loaded={policy:import('../../packages/completion-speech/index.js').CompletionSpeech;capture:import('../../packages/completion-speech/index.js').SpeechTurnCapture};
 let ready:Loaded|undefined,pending:Promise<Loaded>|undefined;
 const load=()=>pending??=import('../../packages/completion-speech/index.js').then(({CompletionSpeech,SpeechTurnCapture})=>{
   const policy=new CompletionSpeech(adapter);return ready={policy,capture:new SpeechTurnCapture(policy)};
 });
 return {
  handle:(input:Record<string,unknown>)=>operation(['pending','claim','replay'].includes(String(input.action)),async()=>(await load()).policy.handle(input)),
  status:async()=>(await load()).policy.status(),
  prepare:(id:string)=>operation(false,async()=>(await load()).capture.prepare(id)),
  event:(id:string,event:unknown)=>{try{const admit=ready?.capture.event(id,event);return admit?()=>operation(false,admit):undefined;}catch{return undefined;}},
 };
}

