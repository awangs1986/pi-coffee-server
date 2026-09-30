import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {it,expect} from 'vitest';
import {HostServer} from '../src/host/server.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {Workspaces} from '../src/host/workspaces.js';

it('discovers current native Pi Skills over authenticated WS without opening a task or creating a transcript',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-command-catalog-')),agentDir=join(root,'agent');
 await mkdir(agentDir);const pi=new RpcPiSessionFactory({cwd:root,agentDir,sessionDir:join(root,'sessions'),args:['--offline','--no-extensions'],env:{PI_OFFLINE:'1',HOME:root}});
 const factory=new NativeAgentFactory({pi,workspaces:new Workspaces(join(root,'projects'))});
 const host=new HostServer({port:0,token:'command-test',factory});await host.start();
 const ws=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer command-test'}});
 const frames:any[]=[];ws.on('message',data=>frames.push(JSON.parse(String(data))));
 const send=(value:object)=>ws.send(JSON.stringify({v:1,...value}));
 const next=async(id:string)=>{await expect.poll(()=>frames.find(f=>f.requestId===id||f.type==='error'),{timeout:15000}).toBeTruthy();return frames.find(f=>f.requestId===id||f.type==='error');};
 try{
  await once(ws,'open');
  send({type:'get_command_catalog',engine:'pi',requestId:'empty'});expect(await next('empty')).toMatchObject({type:'command_catalog',engine:'pi',commands:[]});
  await mkdir(join(agentDir,'skills/example'),{recursive:true});await writeFile(join(agentDir,'skills/example/SKILL.md'),'---\nname: example\ndescription: Installed after preview.\n---\nOnly a fixture.');
  send({type:'get_command_catalog',engine:'pi',requestId:'installed'});
  expect((await next('installed')).commands).toContainEqual({name:'skill:example',description:'Installed after preview.',source:'skill'});
  expect(await pi.list()).toEqual([]);expect(frames.some(f=>f.type==='opened'||f.type==='event')).toBe(false);
  send({type:'get_command_catalog',engine:'claude',requestId:'invalid'});expect(await next('invalid')).toMatchObject({type:'error',code:'invalid_frame'});
 }finally{ws.close();await host.close();await rm(root,{recursive:true,force:true});}
},30000);
