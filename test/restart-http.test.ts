import {mkdtemp,readFile,rm,mkdir,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {WebServer} from '../src/web/server.js';
import {GiteaAuth} from '../src/web/auth.js';

let web:WebServer|undefined,root:string;
afterEach(async()=>{await web?.close();if(root)await rm(root,{recursive:true,force:true});});
async function fixture(reuse=false){
 if(!reuse)root=await mkdtemp(join(tmpdir(),'coffee-restart-'));
 const auth=new GiteaAuth({giteaUrl:'http://fixture',clientId:'fixture',clientSecret:'synthetic',allowedUsers:['owner','other','outsider'],fetch:async(url,options)=>{
  if(String(url).includes('access_token'))return Response.json({access_token:JSON.parse(String(options?.body)).code});
  return Response.json({id:1,login:options?.headers&&new Headers(options.headers).get('authorization')?.replace('token ','')});
 }});
 web=new WebServer({hostUrl:'ws://127.0.0.1:1/host',port:0,auth,restart:{stateDir:root,operators:['login:owner','login:other']}});
 await web.start();const base='http://127.0.0.1:'+web.address().port;
 async function login(code:string){const start=await fetch(base+'/auth/login',{redirect:'manual'});const state=new URL(start.headers.get('location')!).searchParams.get('state');const r=await fetch(base+'/auth/callback?state='+state+'&code='+code,{redirect:'manual',headers:{cookie:start.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')}});expect(r.status).toBe(303);return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
 return {base,owner:await login('owner'),other:await login('other'),outsider:await login('outsider')};
}
it('admits an explicitly confirmed operator restart once, survives Web restart, and hides another operator receipt',async()=>{
 const {base,owner,other,outsider}=await fixture(),id=randomUUID();
 const post=(cookie:string,body:unknown,origin=base)=>fetch(base+'/api/restart',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 expect((await post('',{id,confirmed:true})).status).toBe(401);
 expect((await post(outsider,{id,confirmed:true})).status).toBe(403);
 expect((await post(owner,{id,confirmed:true},'http://evil')).status).toBe(403);
 expect((await post(owner,{id,confirmed:false})).status).toBe(400);
 expect((await post(owner,{id,confirmed:true,command:'sudo reboot'})).status).toBe(400);
 const accepted=await post(owner,{id,confirmed:true});expect(accepted.status).toBe(202);
 expect(await accepted.json()).toMatchObject({operation:{id,phase:'scheduled'}});
 const request=await readFile(join(root,'request.json'),'utf8');expect(JSON.parse(request)).toMatchObject({id,owner:'login:owner',phase:'scheduled'});
 expect((await post(owner,{id,confirmed:true})).status).toBe(202);
 expect(await readFile(join(root,'request.json'),'utf8')).toBe(request);
 expect((await post(other,{id:randomUUID(),confirmed:true})).status).toBe(409);
 const otherStatus=await fetch(base+'/api/restart',{headers:{cookie:other}});expect(await otherStatus.json()).toEqual({available:true,busy:true,operation:null});
 await web!.close();web=undefined;
 const restarted=await fixture(true);
 const receipt=await fetch(restarted.base+'/api/restart?id='+id,{headers:{cookie:restarted.owner}});expect(await receipt.json()).toMatchObject({operation:{id,phase:'scheduled'}});
 await web!.close();web=undefined;
 const reopened=new WebServer({hostUrl:'ws://127.0.0.1:1/host',port:0,allowUnauthenticated:true,restart:{stateDir:root,operators:['login:owner']}});web=reopened;await web.start();
 // A configured default/demo user never gains machine-maintenance authority.
 expect((await fetch('http://127.0.0.1:'+web.address().port+'/api/restart')).status).toBe(401);
});
it('reports a worker failure through authenticated HTTP and prevents a fresh request during cooldown',async()=>{
 const {base,owner}=await fixture(),id=randomUUID(),headers={cookie:owner,origin:base,'content-type':'application/json'};
 expect((await fetch(base+'/api/restart',{method:'POST',headers,body:JSON.stringify({id,confirmed:true})})).status).toBe(202);
 const config=join(root,'worker.json');await writeFile(config,JSON.stringify({stateDir:root,healthTimeoutSeconds:1,targets:['host','web'].map(role=>({role,pause:['/usr/bin/true'],resume:['/usr/bin/true'],restart:['/usr/bin/false'],healthUrl:'http://127.0.0.1:1/healthz'}))}),{mode:0o600});
 await expect(promisify(execFile)('python3',[resolve('scripts/restart-worker.py'),'--config',config])).rejects.toThrow();
 const receipt=await fetch(base+'/api/restart?id='+id,{headers:{cookie:owner}});expect(await receipt.json()).toMatchObject({operation:{id,phase:'failed',step:'restart-host'}});
 expect((await fetch(base+'/api/restart',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),confirmed:true})})).status).toBe(429);
 const retry=await fetch(base+'/api/restart',{method:'POST',headers,body:JSON.stringify({id,confirmed:true})});expect(await retry.json()).toMatchObject({operation:{id,phase:'failed'}});
});
it('keeps admission closed after a partial publication without replaying an orphaned receipt',async()=>{
 const {base,owner}=await fixture(),headers={cookie:owner,origin:base,'content-type':'application/json'};
 await mkdir(join(root,'request.json'));
 expect((await fetch(base+'/api/restart',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),confirmed:true})})).status).toBe(503);
 // Fault injection: a partially published current pointer is lost, while its
 // receipt survives. Another request must not silently reset admission.
 await unlink(join(root,'operation.json'));
 expect((await fetch(base+'/api/restart',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),confirmed:true})})).status).toBe(409);
});
