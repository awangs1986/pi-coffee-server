import {it,expect} from 'vitest';
import {accountScopeInstruction} from '../src/host/session-instructions.js';
import {HostServer} from '../src/host/server.js';
import {WebServer} from '../src/web/server.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('allows only explicitly authorized takeover context while retaining other account boundaries',()=>{
 const instruction=accountScopeInstruction('alice','/synthetic/alice');
 expect(instruction).toContain('explicit /takeover');
 expect(instruction).toContain('source account and conversation ID');
 expect(instruction).toContain('read-only');
 expect(instruction).toContain('credentials');
 expect(instruction).toContain('system owner');
});
it('no longer exposes cross-account read endpoints even with Host authorization',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-retired-reference-'));
 const host=new HostServer({port:0,token:'fixture',factory:new RpcPiSessionFactory({sessionDir:root,cliPath:'/must-not-start'})});await host.start();
 const web=new WebServer({port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture'});await web.start();
 try{
  for(const [port,path] of [[host.address().port,'/api/conversation-reference'],[web.address().port,'/api/cross-user']] as const){
   const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({action:'read',id:'source',conversationId:'destination',sourceId:'source'})});
   expect(response.status).toBe(404);
  }
 }finally{await web.close();await host.close();await rm(root,{recursive:true,force:true});}
});
