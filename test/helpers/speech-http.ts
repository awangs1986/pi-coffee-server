import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HostServer} from '../../src/host/server.js';
import {Workspaces} from '../../src/host/workspaces.js';
import {createCompletionSpeech} from '../../src/host/completion-speech.js';
export async function speechHttp(options:{legacyConsumed?:boolean}={}){
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-recovery-'));
 const workspaces=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});await workspaces.createChatConversation('task');
 const speech=createCompletionSpeech(join(workspaces.root,'.coffee','completion-speech'),workspaces);
 for(const input of [{action:'configure',enabled:true},{action:'select',id:'task',enabled:true},{action:'designate',browserId:'browser-one'}])await speech.handle(input);
 await speech.prepare('task');speech.event('task',{type:'message_end',message:{role:'assistant',content:'Done\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"Verified fixture result."}\n```'}});
 const capture=speech.event('task',{type:'agent_settled'});await workspaces.recordRunStatus('task','settled');await capture?.();
 const completionId=(await workspaces.runStatuses()).get('task')!.completionId!;
 const statePath=join(workspaces.root,'.coffee','completion-speech','state.json');
 if(options.legacyConsumed){const state=JSON.parse(await readFile(statePath,'utf8'));delete state.version;delete state.deliveries;state.attempts.task=completionId;await writeFile(statePath,JSON.stringify(state));}
 const factory={list:async()=>[{id:'task',name:'Fixture title'}],delete:async()=>false,create:async()=>{throw Error('No model request is permitted');}};
 let host:HostServer;
 const start=async()=>{host=new HostServer({port:0,token:'synthetic-recovery',factory,workspaces});await host.start();};await start();
 return {completionId,workspaces,statePath,async call(body:Record<string,unknown>){const response=await fetch(`http://127.0.0.1:${host.address().port}/api/completion-speech`,{method:'POST',headers:{authorization:'Bearer synthetic-recovery','content-type':'application/json'},body:JSON.stringify({protocol:2,...body})});return {status:response.status,body:await response.json() as any};},async restart(){await host.close();await start();},async close(){await host.close();await rm(root,{recursive:true,force:true});}};
}
