import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {WebServer} from '../src/web/server.js';
it('reports separate Web, Host and frontend commits through the authenticated forwarding seam',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-release-http-'));let host:HostServer|undefined,web:WebServer|undefined;
 try{
  const hostDir=join(root,'host'),webDir=join(root,'web'),publicDir=join(webDir,'dist','public');await mkdir(hostDir);await mkdir(publicDir,{recursive:true});
  await writeFile(join(hostDir,'release.json'),JSON.stringify({sourceCommit:'b'.repeat(40),credential:'must not expose'}));
  await writeFile(join(webDir,'release.json'),JSON.stringify({sourceCommit:'a'.repeat(40),path:'/private/store'}));
  await writeFile(join(publicDir,'release-manifest.json'),JSON.stringify({sourceCommit:'c'.repeat(40)}));
  const factory={create:async()=>{throw Error('No native Agent needed');},list:async()=>[],delete:async()=>false};
  host=new HostServer({port:0,host:'127.0.0.1',token:'release-fixture',requireUser:true,factory,releaseDir:hostDir,scopeForUser:()=>({factory})});await host.start();
  expect((await fetch(`http://127.0.0.1:${host.address().port}/api/release`)).status).toBe(401);
  web=new WebServer({port:0,host:'127.0.0.1',hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'release-fixture',defaultUser:'alice',allowUnauthenticated:true,publicDir,releaseDir:webDir});await web.start();
  const r=await fetch(`http://127.0.0.1:${web.address().port}/api/release`);expect(r.status).toBe(200);
  expect(await r.json()).toEqual({webBackendCommit:'a'.repeat(40),frontendCommit:'c'.repeat(40),hostBackendCommit:'b'.repeat(40)});
 }finally{await web?.close();await host?.close();await rm(root,{recursive:true,force:true});}
});
