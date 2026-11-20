import {mkdtemp,open,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {AnswerDeliveries} from '../src/host/answer-deliveries.js';
import {TransferServer} from '../src/host/transfer.js';
import {Workspaces} from '../src/host/workspaces.js';

it('cannot complete a versioned download with bytes rewritten during the transfer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-versioned-stream-'));
 const store=new Workspaces(join(root,'registry'),{taskRoot:join(root,'tasks')});
 const task=await store.createChatConversation('storage');
 const transfer=new TransferServer({port:0,host:'127.0.0.1',workdir:root});
 try {
  const deliveries=new AnswerDeliveries(store,()=>{});await deliveries.begin(task.id,'make');
  deliveries.observe(task.id,{type:'agent_start'});
  const path=join(task.taskRoot!,'artifacts','large.zip'),length=16*1024*1024;
  await writeFile(path,Buffer.alloc(length,65));
  deliveries.observe(task.id,{type:'message_end',message:{role:'assistant',timestamp:1,content:[{type:'text',text:'ready'}]}});
  await deliveries.observe(task.id,{type:'agent_settled'});
  const [answer]=(await deliveries.list(task.id,new Set(['pi-message:1'])))!;
  const file=answer.files[0];await transfer.start();
  const params=new URLSearchParams({scope:task.id,path:file.path,version:file.version!,token:transfer.issueToken(task.id,root,task.id,store)});
  const response=await fetch(transfer.publicUrl()+'/api/localsend/v2/workspace-download?'+params);
  expect(response.status).toBe(200);const reader=response.body!.getReader();await reader.read();
  const writer=await open(path,'r+');try {await writer.write(Buffer.from('different'),0,9,(await stat(path)).size-9);}finally{await writer.close();}
  await expect((async()=>{while(!(await reader.read()).done){ /* drain the response */ }})()).rejects.toThrow();
 } finally {await transfer.close();await rm(root,{recursive:true,force:true});}
});
