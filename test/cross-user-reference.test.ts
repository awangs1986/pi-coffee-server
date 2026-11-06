import {mkdtemp,mkdir,rm,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {WebServer} from '../src/web/server.js';
import {HostServer} from '../src/host/server.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {Workspaces} from '../src/host/workspaces.js';

it('explicitly reads another routed account into an owned conversation without opening its Agent or changing ordinary isolation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-cross-user-'));
 const scope=async(name:string)=>{const sessionDir=join(root,name,'sessions');await mkdir(sessionDir,{recursive:true});return {factory:new RpcPiSessionFactory({sessionDir,cliPath:'/must-not-start-native'}),workspaces:new Workspaces(join(root,name,'projects')),sessionDir};};
 const owner=await scope('owner'),other=await scope('gitea-2');
 await owner.workspaces.createChatConversation('destination','pi');await other.workspaces.createChatConversation('shared-source','pi');
 const at='2026-11-06T00:00:00Z';await writeFile(join(other.sessionDir,'2026-11-06_shared-source.jsonl'),[
 {type:'session',version:3,id:'shared-source',timestamp:at,cwd:'/synthetic'},
 {type:'message',id:'u1',parentId:null,timestamp:at,message:{role:'user',content:[{type:'text',text:'Explain the project decision'}]}},
 {type:'message',id:'a1',parentId:'u1',timestamp:at,message:{role:'assistant',content:[{type:'thinking',thinking:'private reasoning'},{type:'text',text:'Keep the existing architecture'}]}},
 {type:'message',id:'t1',parentId:'a1',timestamp:at,message:{role:'toolResult',toolName:'bash',toolCallId:'tool',content:[{type:'text',text:'PRIVATE TOOL OUTPUT'}],isError:false}}
 ].map(v=>JSON.stringify(v)).join('\n')+'\n');
 const host=new HostServer({port:0,token:'fixture',...owner,scopeForUser:()=>other});await host.start();
 let enabled=true;const routes={'1':{hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',legacyDefault:true},'2':{hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture'}};
 const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',identity:{giteaUrl:'http://gitea.test',clientId:'fixture',clientSecret:'fixture',publicUrl:'http://coffee.test',sharedHost:true,get crossUserRead(){return enabled;},routes:()=>routes,fetch:async(url,options)=>Response.json(String(url).includes('access_token')?{access_token:new URLSearchParams(String(options?.body)).get('code')}:{id:Number(new Headers(options?.headers).get('authorization')?.replace('Bearer ','')),login:'fixture',active:true})}});
 await web.start();const base=`http://127.0.0.1:${web.address().port}`;
 try{
 const start=await fetch(base+'/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')!).searchParams.get('state');const login=await fetch(base+`/auth/callback?state=${state}&code=1`,{redirect:'manual',headers:{cookie:start.headers.get('set-cookie')!.split(';')[0]}});const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const call=(body:object,origin='http://coffee.test',key=cookie)=>fetch(base+'/api/cross-user',{method:'POST',headers:{cookie:key,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const input={conversationId:'destination',sourceId:'shared-source'};
 const response=await call(input);expect(response.status).toBe(200);const result=await response.json();expect(result.sourceId).toBe('shared-source');expect(result.prompt).toContain('Explain the project decision');expect(result.prompt).toContain('Keep the existing architecture');expect(result.prompt).not.toContain('private reasoning');expect(result.prompt).not.toContain('PRIVATE TOOL OUTPUT');
 expect((await call({...input,sourceUser:'gitea-2'})).status).toBe(400);
 expect((await call({...input,sourceId:'../shared-source'})).status).toBe(400);
 expect((await call({...input,sourceId:'missing'})).status).toBe(404);
 expect((await call(input,'http://evil.test')).status).toBe(403);expect((await call(input,'http://coffee.test','')).status).toBe(401);
 expect((await call({...input,conversationId:'shared-source'})).status).toBe(403);
 const ordinary=await fetch(base+'/api/workspace',{method:'POST',headers:{cookie,origin:'http://coffee.test','content-type':'application/json'},body:JSON.stringify({action:'files',id:'shared-source'})});expect(ordinary.status).toBe(409);
 (routes as Record<string,typeof routes['2']>)['3']={...routes['2']};expect((await call(input)).status).toBe(409);delete (routes as Record<string,typeof routes['2']>)['3'];
 await appendFile(join(other.sessionDir,'2026-11-06_shared-source.jsonl'),JSON.stringify({type:'message',id:'u2',parentId:'t1',timestamp:at,message:{role:'user',content:[{type:'text',text:'x'.repeat(60000)+'RECENT-END'}]}})+'\n');
 const bounded=await (await call(input)).json();expect(bounded.truncated).toBe(true);expect(bounded.messages).toHaveLength(1);expect(bounded.messages[0].text).toHaveLength(48000);expect(bounded.messages[0].text).toMatch(/RECENT-END$/);expect(bounded.prompt).toContain('truncated');
 await other.workspaces.archive('shared-source',true);expect((await call(input)).status).toBe(404);
 enabled=false;expect((await call(input)).status).toBe(403);
 }finally{await web.close();await host.close();await rm(root,{recursive:true,force:true});}
});
