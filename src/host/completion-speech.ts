import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CompletionSpeech,SpeechTurnCapture,type SpeechState} from '../../packages/completion-speech/index.js';
import type {Workspaces} from './workspaces.js';
/** File storage and authenticated task admission are Coffee responsibilities. */
export function createCompletionSpeech(root:string,workspaces:Workspaces,titles?:()=>Promise<Array<{id:string;name?:string}>>){
 const path=join(root,'state.json');
 const policy=new CompletionSpeech({
  load:async()=>{try{return JSON.parse(await readFile(path,'utf8')) as SpeechState;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}},
  save:async state=>{await mkdir(root,{recursive:true,mode:0o700});const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,path);},
  task:async id=>{const task=await workspaces.lookup(id);if(!task)return;const status=(await workspaces.runStatuses()).get(id);return {id,title:(await titles?.())?.find(t=>t.id===id)?.name||'未命名对话',engine:task.engine??'pi',archived:Boolean(task.archived||task.workspaceRemoved||task.cleanupStarted),...status};}
 });
 const capture=new SpeechTurnCapture(policy);return {handle:policy.handle.bind(policy),status:policy.status.bind(policy),prepare:capture.prepare.bind(capture),event:capture.event.bind(capture),policy};
}

export {SpeechTurnCapture} from '../../packages/completion-speech/index.js';
