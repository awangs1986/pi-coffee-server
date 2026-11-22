import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {WebServer} from '../src/web/server.js';
import {parseUserRoutes} from '../src/web/identity.js';
it('reports separate Web, Host and frontend commits through the authenticated forwarding seam',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-release-http-'));let host:HostServer|undefined,web:WebServer|undefined;
 try{
  const hostDir=join(root,'host'),webDir=join(root,'web'),publicDir=join(webDir,'dist','public');await mkdir(hostDir);await mkdir(publicDir,{recursive:true});
  await writeFile(join(hostDir,'release.json'),JSON.stringify({version:'0.11',sourceCommit:'b'.repeat(40),credential:'must not expose'}));
  await writeFile(join(webDir,'release.json'),JSON.stringify({version:'0.12',sourceCommit:'a'.repeat(40),path:'/private/store'}));
  await writeFile(join(publicDir,'release-manifest.json'),JSON.stringify({version:'0.13',sourceCommit:'c'.repeat(40)}));
  const factory={create:async()=>{throw Error('No native Agent needed');},list:async()=>[],delete:async()=>false};
  host=new HostServer({port:0,host:'127.0.0.1',token:'release-fixture',requireUser:true,factory,releaseDir:hostDir,scopeForUser:()=>({factory})});await host.start();
  expect((await fetch(`http://127.0.0.1:${host.address().port}/api/release`)).status).toBe(401);
  web=new WebServer({port:0,host:'127.0.0.1',hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'release-fixture',defaultUser:'alice',allowUnauthenticated:true,publicDir,releaseDir:webDir});await web.start();
  const r=await fetch(`http://127.0.0.1:${web.address().port}/api/release`);expect(r.status).toBe(200);
  expect(await r.json()).toEqual({webVersion:'0.12',frontendVersion:'0.13',hostVersion:'0.11',webBackendCommit:'a'.repeat(40),frontendCommit:'c'.repeat(40),hostBackendCommit:'b'.repeat(40)});
  await writeFile(join(hostDir,'release.json'),JSON.stringify({sourceCommit:'b'.repeat(40),version:0.11}));await writeFile(join(webDir,'release.json'),JSON.stringify({sourceCommit:'a'.repeat(40),version:'<script>bad</script>'}));await writeFile(join(publicDir,'release-manifest.json'),JSON.stringify({sourceCommit:'c'.repeat(40)}));
  expect(await (await fetch(`http://127.0.0.1:${web.address().port}/api/release`)).json()).toMatchObject({webVersion:'unknown',hostVersion:'unknown',frontendVersion:'unknown'});
 }finally{await web?.close();await host?.close();await rm(root,{recursive:true,force:true});}
});

it('forwards fresh disk-backup health and the last completed date only to the authenticated owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coffee-release-backup-'));
  const factory = {
    create: async () => { throw Error('No native Agent needed'); },
    list: async () => [],
    delete: async () => false,
  };
  const lastBackupAt = '2025-11-22T06:10:52+08:00';
  await writeFile(join(root, 'receipt.json'), JSON.stringify({
    last_success: {result:'success', exit_status:'0', finished_at:lastBackupAt, id:'private-invocation'},
  }), {mode:0o600});
  const writeStatus = (at: string, status = 'verified') => writeFile(join(root,'status.json'), JSON.stringify({
    at, status, repository:'/private/restic/repository', verified_snapshot:'private-snapshot',
  }), {mode:0o600});
  await writeStatus(new Date().toISOString());
  const host = new HostServer({port:0, host:'127.0.0.1', token:'fixture', factory, diskBackupStatusDir:root});
  await host.start();
  const hostUrl = `ws://127.0.0.1:${host.address().port}/host`;
  const routes = parseUserRoutes(JSON.stringify({
    1:{hostUrl, hostToken:'fixture', legacyDefault:true},
    2:{hostUrl, hostToken:'fixture'},
  }));
  const web = new WebServer({port:0, host:'127.0.0.1', hostUrl, identity:{
    giteaUrl:'http://gitea.test',clientId:'fixture',clientSecret:'fixture',publicUrl:'http://coffee.test',
    sharedHost:true,routes:()=>routes,
    fetch:async (url, options) => {
      if (String(url).includes('access_token')) return Response.json({access_token:new URLSearchParams(String(options?.body)).get('code')});
      const id = Number(new Headers(options?.headers).get('authorization')?.replace('Bearer ', ''));
      return Response.json({id,login:id===1?'awangs':'visitor',active:true});
    },
  }});
  try {
    await web.start();
    const base = `http://127.0.0.1:${web.address().port}`;
    const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
    const signIn = async (id: number) => {
      const login = await fetch(base+'/auth/login',{redirect:'manual'});
      const state = new URL(login.headers.get('location')!).searchParams.get('state');
      const callback = await fetch(base+`/auth/callback?state=${state}&code=${id}`,{redirect:'manual',headers:{cookie:cookie(login)}});
      expect(callback.status).toBe(302);
      return cookie(callback);
    };
    expect((await fetch(base+'/api/release')).status).toBe(401);
    const owner = await signIn(1), visitor = await signIn(2);
    const read = async (session: string) => {
      const response = await fetch(base+'/api/release',{headers:{cookie:session,'x-pi-coffee-actor':'awangs'}});
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      return (await response.json()).diskBackup;
    };
    expect(await read(owner)).toEqual({state:'healthy',lastBackupAt:'2025-11-21T22:10:52.000Z'});
    expect(await read(visitor)).toBeUndefined();
    await writeStatus(new Date(Date.now()-60*60_000).toISOString());
    expect(await read(owner)).toEqual({state:'stale',lastBackupAt:'2025-11-21T22:10:52.000Z'});
    await writeStatus(new Date().toISOString(),'daily_backup_missing');
    expect(await read(owner)).toEqual({state:'warning',lastBackupAt:'2025-11-21T22:10:52.000Z'});
    await writeFile(join(root,'status.json'),'{');
    expect(await read(owner)).toEqual({state:'unavailable',lastBackupAt:'2025-11-21T22:10:52.000Z'});
  } finally {
    await web.close();
    await host.close();
    await rm(root,{recursive:true,force:true});
  }
});
