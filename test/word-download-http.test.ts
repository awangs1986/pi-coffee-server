import {mkdtemp,rm,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {Workspaces} from '../src/host/workspaces.js';
import {TransferServer} from '../src/host/transfer.js';

it('discovers and downloads generated Word files with scoped grants and intact bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-word-files-'));
 const store=new Workspaces(join(root,'registry'),{taskRoot:join(root,'tasks')});
 const task=await store.createChatConversation('word-chat'),other=await store.createChatConversation('other-chat');
 const transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root,workspaces:store});await transfer.start();
 try{
  const doc=Buffer.from([0xd0,0xcf,0x11,0xe0,0,255]),docx=Buffer.from([0x50,0x4b,3,4,0,255]);
  await writeFile(join(root,'tasks/word-chat/artifacts/结果.doc'),doc);
  await writeFile(join(root,'tasks/word-chat/artifacts/结果.docx'),docx);
  await writeFile(join(root,'tasks/word-chat/attachments/input.docx'),docx);
  await writeFile(join(root,'tasks/word-chat/artifacts/credentials.docx'),docx);
  await writeFile(join(other.cwd,'private.docx'),docx);
  await symlink(join(other.cwd,'private.docx'),join(root,'tasks/word-chat/artifacts/escape.docx'));
  const base=`http://127.0.0.1:${transfer.address().port}/api/localsend/v2/`;
  const params=new URLSearchParams({scope:task.id,token:transfer.issueToken(task.id,root,task.id,store)});
  expect((await fetch(base+'artifacts')).status).toBe(401);
  const list=(await (await fetch(base+'artifacts?'+params)).json()).artifacts;
  expect(list.map((a:any)=>a.path).sort()).toEqual(['../artifacts/结果.doc','../artifacts/结果.docx']);
  for(const [path,bytes,mime] of [['../artifacts/结果.doc',doc,'application/msword'],['../artifacts/结果.docx',docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document']] as const){
   const response=await fetch(base+'workspace-download?'+params+'&'+new URLSearchParams({path}));
   expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe(mime);
   expect(response.headers.get('content-disposition')).toContain("attachment; filename*=UTF-8''"+encodeURIComponent(path.split('/').at(-1)!));
   expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  }
  const otherParams=new URLSearchParams({scope:other.id,token:transfer.issueToken(other.id,root,other.id,store),path:'../../word-chat/artifacts/结果.docx'});
  expect((await fetch(base+'workspace-download?'+otherParams)).status).toBe(403);
 }finally{await transfer.close();await rm(root,{recursive:true,force:true});}
});
