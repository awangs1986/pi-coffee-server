import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {expect,it} from 'vitest';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';

it.each(['task','report'] as const)('keeps cancelled %s evidence incomplete after restart despite an earlier successful answer',async kind=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-cancelled-evidence-'));const runId=randomUUID();
 try{
  const native=SessionManager.create(root,join(root,'sessions'));
  native.appendCustomEntry('coffee-native-run',{version:1,runId,baselineId:native.getLeafId(),...(kind==='report'?{origin:'task-report'}:{})});
  if(kind==='report')native.appendCustomMessageEntry('coffee-task-report','Synthetic reporting input',false,{processingId:runId});
  else native.appendMessage({role:'user',content:'Synthetic task',timestamp:Date.now()});
  native.appendMessage({role:'assistant',content:[{type:'text',text:'EARLIER_PARTIAL_ANSWER'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
  native.appendCustomEntry('coffee-native-settled',{version:1,runId,aborted:true});
  const id=native.getSessionId();
  for(let n=0;n<2;n++){
   const restarted=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions')});
   expect(await restarted.readRunEvidence(id,runId)).toMatchObject({freshness:'current',state:'incomplete'});
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
