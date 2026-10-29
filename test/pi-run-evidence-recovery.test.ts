import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {expect,it,vi} from 'vitest';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';

it('recovers a transient native listing failure without changing or replaying a settled run, and keeps persistent failure uncertain',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-evidence-recovery-')),runId=randomUUID();
 let listing:ReturnType<typeof vi.spyOn>|undefined;
 try{
  const native=SessionManager.create(root,join(root,'sessions'));
  native.appendCustomEntry('coffee-native-run',{version:1,runId,baselineId:native.getLeafId()});
  native.appendMessage({role:'user',content:'Synthetic existing task',timestamp:1});
  native.appendMessage({role:'assistant',content:[{type:'text',text:'SETTLED_ORIGINAL'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:2});
  native.appendCustomEntry('coffee-native-settled',{version:1,runId,aborted:false});
  const file=native.getSessionFile()!,before=await readFile(file,'utf8');
  const factory=new RpcPiSessionFactory({sessionDir:join(root,'sessions'),cliPath:'/no-execution-allowed'});
  listing=vi.spyOn(SessionManager,'listAll');
  listing.mockRejectedValueOnce(new Error('Native writer temporarily owns the session listing'));
  expect(await factory.readRunEvidence(native.getSessionId(),runId)).toMatchObject({freshness:'current',state:'reply-available',entries:[{text:'SETTLED_ORIGINAL'}]});
  listing.mockRejectedValue(new Error('Native source remains unavailable'));
  expect(await factory.readRunEvidence(native.getSessionId(),runId)).toMatchObject({freshness:'unknown',state:'uncertain'});
  expect(await readFile(file,'utf8')).toBe(before);
 }finally{listing?.mockRestore();await rm(root,{recursive:true,force:true});}
});
