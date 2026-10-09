import {it,expect,afterEach} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {GitHubAccounts} from '../src/host/github-accounts.js';
import {githubRenewalClient} from '../src/host/github-renewal.js';
import {WebServer} from '../src/web/server.js';
import {Identity} from '../src/web/identity.js';
import {oauthCredentials} from '../src/shared/github-credentials.js';
const exec=promisify(execFile);
let root='',api:Server,web:WebServer;
const managers:GitHubAccounts[]=[];
afterEach(async()=>{await Promise.all(managers.splice(0).map(m=>m.close()));await web?.close();if(api)await new Promise<void>(r=>api.close(()=>r()));if(root)await rm(root,{recursive:true,force:true});});
async function setup(){
 root=await mkdtemp(join(tmpdir(),'coffee-renewal-'));let now=Date.now(),exchanges=0,hold:Promise<void>|undefined,release:()=>void=()=>{},started:()=>void=()=>{},failure='',wrongIdentity=false;
 api=createServer((req,res)=>{void (async()=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/login/oauth/access_token'){
   let bytes='';for await(const chunk of req)bytes+=chunk;const request=JSON.parse(bytes);
   expect(request.grant_type).toBe('refresh_token');expect(request.client_secret).toBe('fixture-app-secret');exchanges++;started();await hold;
   if(failure){res.statusCode=failure==='invalid_grant'?200:503;res.end(JSON.stringify({error:failure}));return;}
   res.end(JSON.stringify({access_token:'renewed-'+exchanges,refresh_token:'rotated-'+exchanges,expires_in:28800,refresh_token_expires_in:15552000}));
  }else if(req.url==='/user')res.end(JSON.stringify({id:wrongIdentity&&req.headers.authorization?.includes('renewed-')?99:42,login:'fixture-user'}));
  else {res.statusCode=404;res.end('{}');}
 })();});
 await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const a=api.address();if(!a||typeof a==='string')throw Error('address');const provider=`http://127.0.0.1:${a.port}`;
 web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',hostToken:'fixture-host-secret',githubOAuth:{clientId:'fixture-app',clientSecret:'fixture-app-secret',publicUrl:'http://coffee.test',providerUrl:provider}});await web.start();const base=`http://127.0.0.1:${web.address().port}`;
 const make=(user:string)=>{const m=new GitHubAccounts(join(root,user),{apiUrl:provider,now:()=>now,renew:githubRenewalClient(base+'/internal/github-refresh','fixture-host-secret',user)});managers.push(m);return m;};
 const alice=make('alice');
 const bind=(m=alice,token='original')=>m.handle({action:'bind',token,refreshToken:'refresh-'+token,expiresAt:now+61000,refreshExpiresAt:now+15552000000});await bind();
 return {alice,make,bind,base,expire:()=>{now+=2000;},count:()=>exchanges,fail:(value:string)=>{failure=value;},wrong:()=>{wrongIdentity=true;},pause:()=>{hold=new Promise(r=>{release=r;});return new Promise<void>(r=>{started=r;});},release:()=>release()};
}
it('renews once for concurrent real native helpers and an existing API client, persists rotation and hides all private fields',async()=>{
 const f=await setup();const client=await f.alice.client('github-42');await f.alice.environment('github-42');f.expire();
 const script=fileURLToPath(new URL('../dist/src/host/github-tools.mjs',import.meta.url));
 // credential helper reads stdin; gh runs a real subprocess without exposing refresh credentials.
 const shim=join(root,'fixture-gh');await writeFile(shim,'#!/bin/sh\nprintf "%s" "$GH_TOKEN"\n',{mode:0o700});
 const gh=()=>exec(process.execPath,[script,'gh',f.alice.file,'github-42',shim,'api','user']);
 const results=await Promise.all([client.identity(),client.identity(),gh(),gh()]);
 expect(f.count()).toBe(1);expect(results[0]).toMatchObject({githubId:'42'});expect((results[2] as {stdout:string}).stdout).toBe('renewed-1');
 const stored=JSON.parse(await readFile(f.alice.file,'utf8')).accounts[0];expect(stored.refreshToken).toBe('rotated-1');
 expect((await stat(f.alice.file)).mode&0o777).toBe(0o600);
 const metadata=JSON.stringify(await f.alice.list());for(const key of ['token','refreshToken','expiresAt','credentialVersion'])expect(metadata).not.toContain(key);
 const restarted=f.make('alice');expect(await restarted.token('github-42')).toBe('renewed-1');
 const bob=f.make('bob');await expect(bob.token('github-42')).rejects.toThrow('missing or disconnected');
 // Retain the actual Git credential protocol probe with stdin.
 const child=execFile(process.execPath,[script,'credential',f.alice.file,'github-42','get']);child.stdin!.end('protocol=https\nhost=github.com\n\n');
 const output=await new Promise<string>((resolve,reject)=>{let s='';child.stdout!.on('data',c=>s+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve(s):reject(Error('helper failed')));});expect(output).toContain('password=renewed-1');
});
it.each(['rebind','delete'])('fences a %s while renewal is in flight',async(action)=>{
 const f=await setup();f.expire();const entered=f.pause(),pending=f.alice.token('github-42');await entered;
 if(action==='rebind')await f.bind(f.alice,'new-login');else await f.alice.handle({action:'delete',id:'github-42'});
 f.release();if(action==='rebind')expect(await pending).toBe('new-login');else await expect(pending).rejects.toThrow('missing or disconnected');
 const stored=JSON.parse(await readFile(f.alice.file,'utf8')).accounts;expect(stored.map((a:{token:string})=>a.token)).toEqual(action==='rebind'?['new-login']:[]);
});
it('retains reconnect and deletion fencing even when the old renewal is rejected',async()=>{
 const f=await setup();f.expire();f.fail('invalid_grant');const entered=f.pause(),pending=f.alice.token('github-42');await entered;await f.bind(f.alice,'new-login');f.release();expect(await pending).toBe('new-login');
});
it('surfaces revocation without retry loops, never falls back to another account, and recovers on explicit rebind',async()=>{
 const f=await setup();f.expire();f.fail('invalid_grant');await expect(f.alice.token('github-42')).rejects.toThrow('github_reconnect_required');await expect(f.alice.token('github-42')).rejects.toThrow('github_reconnect_required');expect(f.count()).toBe(1);
 await f.bind(f.alice,'new-login');expect(await f.alice.token('github-42')).toBe('new-login');
});
it('bounds transient failures without destroying refresh credentials',async()=>{
 const f=await setup();f.expire();f.fail('temporarily_unavailable');await expect(f.alice.token('github-42')).rejects.toThrow('github_refresh_unavailable');await expect(f.alice.token('github-42')).rejects.toThrow('github_refresh_unavailable');expect(f.count()).toBe(1);expect(JSON.parse(await readFile(f.alice.file,'utf8')).accounts[0].refreshToken).toBe('refresh-original');
});
it('rejects a rotated access token belonging to a different GitHub identity',async()=>{
 const f=await setup();f.expire();f.wrong();await expect(f.alice.token('github-42')).rejects.toThrow('github_reconnect_required');expect(JSON.parse(await readFile(f.alice.file,'utf8')).accounts[0].token).toBe('original');
});
it('rejects anonymous, browser-cookie, browser-origin, invalid and oversized renewal requests without exchanging secrets',async()=>{
 const f=await setup();const call=(headers:Record<string,string>,body:unknown)=>fetch(f.base+'/internal/github-refresh',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 expect((await call({},{})).status).toBe(401);expect((await call({authorization:'Bearer wrong'},{})).status).toBe(401);
 for(const extra of [{cookie:'coffee_session=x'},{origin:'http://coffee.test'}])expect((await call({authorization:'Bearer fixture-host-secret',...extra},{})).status).toBe(401);
 expect((await call({authorization:'Bearer fixture-host-secret'},{refreshToken:42})).status).toBe(400);expect((await call({authorization:'Bearer fixture-host-secret'},{refreshToken:'x'.repeat(9000)})).status).toBe(503);expect(f.count()).toBe(0);
});
it('admits only the configured user route at the Web service boundary',()=>{
 const identity=new Identity({giteaUrl:'http://gitea.invalid',clientId:'id',clientSecret:'secret',publicUrl:'http://coffee.test',sharedHost:true,routes:()=>({'1':{hostUrl:'ws://127.0.0.1/host',hostToken:'one'},'2':{hostUrl:'ws://127.0.0.1/host',hostToken:'two'}})});
 const request=(user:string,token:string)=>({headers:{authorization:'Bearer '+token,'x-pi-coffee-user':user}} as import('node:http').IncomingMessage);
 expect(identity.authorizesHost(request('gitea-1','one'))).toBe(true);expect(identity.authorizesHost(request('gitea-2','one'))).toBe(false);expect(identity.authorizesHost(request('gitea-9','one'))).toBe(false);
});
it('preserves non-expiring grants and rejects malformed renewal metadata',()=>{
 expect(oauthCredentials({access_token:'fixture-static'})).toEqual({token:'fixture-static'});expect(()=>oauthCredentials({access_token:'x',expires_in:1,refresh_token:'r',refresh_token_expires_in:-1})).toThrow();
});
