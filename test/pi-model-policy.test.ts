import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {it,expect} from 'vitest';
import {HostServer} from '../src/host/server.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';

it('enforces Pi model choices through the authenticated Host, including slash commands and old sessions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-model-policy-'));
 const factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),cwd:root,sessionDir:root,allowedModels:['fake/fake-large']});
 const host=new HostServer({port:0,token:'model-policy-test',factory});await host.start();
 const ws=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer model-policy-test'}});
 const frames:any[]=[];ws.on('message',data=>frames.push(JSON.parse(String(data))));
 const send=(frame:object)=>ws.send(JSON.stringify({v:1,...frame}));
 const next=async(predicate:(f:any)=>boolean)=>{for(let i=0;i<300;i++){const index=frames.findIndex(predicate);if(index>=0)return frames.splice(index,1)[0];await new Promise(r=>setTimeout(r,10));}throw new Error('Expected frame did not arrive');};
 try{
  await once(ws,'open');send({type:'open',sessionId:'policy-task'});await next(f=>f.type==='history');
  send({type:'get_models'});const catalog=await next(f=>f.type==='models');
  expect(catalog.models.map((m:any)=>m.id)).toEqual(['fake-large']);expect(catalog.current).toBeNull();
  send({type:'set_model',requestId:'denied',provider:'fake',id:'fake-mini'});
  expect(await next(f=>f.requestId==='denied')).toMatchObject({type:'error',message:expect.stringContaining('not allowed')});
  send({type:'prompt',requestId:'old-model',text:'do not run this with the old model'});
  expect(await next(f=>f.type==='error' && f.requestId==='old-model')).toMatchObject({message:expect.stringContaining('not allowed')});
  send({type:'prompt',requestId:'slash-denied',text:'/model fake/fake-mini'});
  expect(await next(f=>f.type==='error' && f.requestId==='slash-denied')).toMatchObject({message:expect.stringContaining('not allowed')});
  send({type:'prompt',requestId:'slash-allowed',text:'/model fake/fake-large'});
  await next(f=>f.type==='event' && f.event.type==='agent_settled');
  send({type:'get_models'});expect(await next(f=>f.type==='models')).toMatchObject({current:{provider:'fake',id:'fake-large'}});
  send({type:'prompt',requestId:'allowed-turn',text:'hello with allowed model'});
  await next(f=>f.type==='event' && f.event.type==='agent_settled');
  expect(frames.some(f=>f.type==='event' && JSON.stringify(f.event).includes('echo: hello with allowed model'))).toBe(true);
 }finally{ws.close();await host.close();await rm(root,{recursive:true,force:true});}
});
