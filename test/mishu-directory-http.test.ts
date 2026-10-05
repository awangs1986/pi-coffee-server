import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';

it('offers only recent unarchived conversations, using real turn activity rather than a rename',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-recent-')),store=join(root,'work'),seed=new Workspaces(store),now=Date.now(),date=(hours:number)=>new Date(now-hours*3600000).toISOString();
 const source=await seed.createChatConversation(),recent=await seed.createChatConversation(),old=await seed.createChatConversation(),renamedOld=await seed.createChatConversation(),archived=await seed.createChatConversation(),activeOld=await seed.createChatConversation();
 await seed.archive(archived.id,true);
 const file=join(store,'.coffee','state.json'),state=JSON.parse(await readFile(file,'utf8'));
 state.conversations.find((c:any)=>c.id===renamedOld.id).lastActivityAt=date(96);
 state.conversations.find((c:any)=>c.id===activeOld.id).createdAt=date(240);
 const historical=Array.from({length:205},(_,i)=>({...state.conversations.find((c:any)=>c.id===old.id),id:'historical-'+i,createdAt:date(240)}));
 state.conversations=[...historical,...state.conversations];
 await writeFile(file,JSON.stringify(state));
 const workspaces=new Workspaces(store),pi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions')});
 const summaries=[{id:old.id,name:'Old',updatedAt:date(96)},{id:recent.id,name:'Recent',updatedAt:date(1)},{id:renamedOld.id,name:'New name only',updatedAt:date(0)},{id:archived.id,name:'Archived',updatedAt:date(0)},{id:activeOld.id,name:'Long-lived project',updatedAt:date(240)}].map(s=>({...s,createdAt:date(240),messageCount:2,preview:'Synthetic',running:false}));
 summaries.unshift(...historical.map(c=>({id:c.id,name:'Historical',updatedAt:date(96),createdAt:date(240),messageCount:2,preview:'Synthetic',running:false})));
 const factory={create:pi.create.bind(pi),list:async()=>summaries,delete:pi.delete.bind(pi)};
 const host=new HostServer({port:0,token:'fixture',factory,workspaces});
 try{
  await host.start();await fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({action:'select',id:source.id,selected:true})});
  const runtime=await host.mishuRuntime(undefined,source.id);
  const directory=async()=>await (await fetch(runtime.env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+runtime.env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify({action:'directory'})})).json();
  expect((await directory()).conversations.map((c:any)=>c.id)).toEqual([recent.id]);
  await workspaces.markRun(activeOld.id,'running');await workspaces.markRun(activeOld.id,'idle');
  expect((await directory()).conversations.map((c:any)=>c.id)).toEqual([activeOld.id,recent.id]);
  const restored=new Workspaces(store);expect(Date.parse((await restored.lookup(activeOld.id))!.lastActivityAt!)).toBeGreaterThan(now-1000);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
