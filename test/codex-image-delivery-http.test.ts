import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,link,truncate,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {TransferServer} from '../src/host/transfer.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const fn of cleanup.reverse())await fn();cleanup.length=0;});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4T8AAAAASUVORK5CYII=','base64');
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'coffee-native-image-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'codex'),ws=new Workspaces(join(root,'projects'),{taskRoot:join(root,'tasks')});
 const task=await ws.createChatConversation('image-task','codex');await ws.setNativeBinding(task.id,{state:'bound',id:'native-image-thread'});
 const factory=new NativeAgentFactory({workspaces:ws,pi:{list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native/model execution is allowed');}},codexSessionOptions:()=>({codexHome:home})});
 const transfer=new TransferServer({host:'127.0.0.1',port:0,advertiseHost:'127.0.0.1',workdir:root});await transfer.start();cleanup.push(()=>transfer.close());
 const host=new HostServer({port:0,token:'fixture',factory,workspaces:ws,scopeForUser:user=>user==='alice'?{factory,workspaces:ws}:{factory,workspaces:new Workspaces(join(root,'foreign'))},transfer});await host.start();cleanup.push(()=>host.close());
 const image=join(home,'generated_images','native-image-thread','exec-picture.png');await mkdir(join(home,'generated_images','native-image-thread'),{recursive:true});await writeFile(image,png);
 const fileGrant=(user:string)=>fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify({action:'files',id:task.id})});
 const response=await fileGrant('alice');expect(response.status).toBe(200);const grant=await response.json();
 const get=(route:string,path=image)=>fetch(grant.url+'/api/localsend/v2/'+route+'?'+new URLSearchParams({scope:grant.scope,token:grant.token,path}));
 return {root,home,ws,task,image,get,fileGrant};
}
it('previews and downloads the task-owned native PNG through its scoped grant and retains an independent task image',async()=>{
 const a=await setup();
 const preview=await a.get('preview');expect(preview.status).toBe(200);expect(preview.headers.get('content-type')).toBe('image/png');expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
 const download=await a.get('workspace-download');expect(download.status).toBe(200);expect(download.headers.get('content-disposition')).toContain('attachment');expect(Buffer.from(await download.arrayBuffer())).toEqual(png);
 const images=(await a.ws.artifacts(a.task.id)).filter(item=>item.path.startsWith('../images/'));expect(images).toHaveLength(1);
 expect(await readFile(await a.ws.file(a.task.id,images[0].path))).toEqual(png);
 await rm(a.image);expect(Buffer.from(await (await a.get('workspace-download')).arrayBuffer())).toEqual(png);
});
it('denies foreign native bindings, unsafe image links, traversal and native credentials without importing them',async()=>{
 const a=await setup(),other=join(a.home,'generated_images','foreign-thread');await mkdir(other);await writeFile(join(other,'exec-foreign.png'),png);
 const external=join(a.root,'outside.png');await writeFile(external,png);
 const own=join(a.home,'generated_images','native-image-thread');await symlink(external,join(own,'exec-link.png'));await link(external,join(own,'exec-hard.png'));await writeFile(join(own,'exec-text.png'),'private text, not an image');
 await symlink(other,join(a.home,'generated_images','linked-thread'));
 await writeFile(join(a.home,'auth.json'),'PRIVATE_CREDENTIAL_FIXTURE');
 for(const path of [join(other,'exec-foreign.png'),join(own,'exec-link.png'),join(own,'exec-hard.png'),join(own,'exec-text.png'),join(a.home,'generated_images','linked-thread','exec-foreign.png'),join(a.home,'auth.json'),own+'/../foreign-thread/exec-foreign.png']){
  expect((await a.get('workspace-download',path)).status,path).toBe(403);
 }
 expect(await readdir(join(a.task.taskRoot!,'images'))).toEqual([]);
});
it('keeps preview and import size limits, while allowing an independent large-image download',async()=>{
 const a=await setup(),own=join(a.home,'generated_images','native-image-thread');
 const oversize=join(own,'exec-oversize.png');await writeFile(oversize,png);await truncate(oversize,256*1024*1024+1);
 expect((await a.get('workspace-download',oversize)).status).toBe(403);
 const large=join(own,'exec-large.png');await writeFile(large,png);await truncate(large,10*1024*1024+1);
 expect((await a.get('preview',large)).status).toBe(413);
 const downloaded=await a.get('workspace-download',large);expect(downloaded.status).toBe(200);expect((await downloaded.arrayBuffer()).byteLength).toBe(10*1024*1024+1);
});
it('coalesces simultaneous preview/download into one private task copy',async()=>{
 const a=await setup(),responses=await Promise.all([a.get('preview'),a.get('workspace-download'),a.get('preview')]);
 for(const response of responses){expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(png);}
 const names=await readdir(join(a.task.taskRoot!,'images'));expect(names).toHaveLength(1);expect(names[0]).toMatch(/^codex-[a-f0-9]+\.png$/);
});
it('loads several different images in one reply without treating its own imports as conflicting task operations',async()=>{
 const a=await setup(),paths=[];
 for(let i=0;i<6;i++){const path=join(a.home,'generated_images','native-image-thread',`exec-image-${i}.png`);await writeFile(path,png);paths.push(path);}
 const responses=await Promise.all(paths.map(path=>a.get('preview',path)));
 for(const response of responses){expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(png);}
 expect(await readdir(join(a.task.taskRoot!,'images'))).toHaveLength(6);
});
it('rejects another account requesting this task file grant',async()=>{
 const a=await setup();expect((await a.fileGrant('bob')).status).toBe(409);expect(await readdir(join(a.task.taskRoot!,'images'))).toEqual([]);
});
it('recovers a published image after an interrupted staging unlink without adopting unrelated links',async()=>{
 const a=await setup();expect((await a.get('preview')).status).toBe(200);
 const directory=join(a.task.taskRoot!,'images'),[name]=await readdir(directory),pending=join(directory,'.native-image-11111111-2222-4333-8444-555555555555');
 await link(join(directory,name),pending);await rm(a.image);
 const download=await a.get('workspace-download');expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(png);expect(await readdir(directory)).toEqual([name]);
});
