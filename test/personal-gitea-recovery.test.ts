import {BackupJobRunner} from '../src/host/backup-job-runner.js';
import {it,expect} from 'vitest';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,type Browser} from 'playwright';
import {giteaBackupFixture,freePort} from './gitea-backup-fixture.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {GiteaBackupJob} from '../src/host/gitea-backup.js';
import {WebServer} from '../src/web/server.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC||!process.env.PI_COFFEE_TEST_GITEA)('restores real Gitea accounts, repository and OAuth login from the administrator backup',async()=>{
 const f=await giteaBackupFixture();let web:WebServer|undefined,host:HostServer|undefined,browser:Browser|undefined;
 try{
  const owner=await f.api('user'),second=await f.api('users/second');await f.api('user/repos',{name:'notes',private:true,auto_init:true});
  const issue=await f.api('repos/owner/notes/issues',{title:'Backup attachment fixture'}),form=new FormData();form.set('attachment',new Blob(['Gitea attachment bytes'],{type:'text/plain'}),'fixture.txt');
  const attachmentResponse=await fetch(`http://127.0.0.1:${f.port}/api/v1/repos/owner/notes/issues/${issue.number}/assets`,{method:'POST',headers:{authorization:'Basic '+Buffer.from('owner:Synthetic-fixture-password-123!').toString('base64')},body:form});expect(attachmentResponse.status).toBe(201);const attachment=await attachmentResponse.json();
  const webPort=await freePort(),origin=`http://127.0.0.1:${webPort}`;
  const app=await f.api('user/applications/oauth2',{name:'Coffee Backup Fixture',redirect_uris:[origin+'/auth/callback'],confidential_client:true});
  const disk=join(f.root,'disk');await mkdir(disk,{mode:0o700});const runtime=join(f.root,'runtime');await mkdir(runtime,{mode:0o700});
  const repository=new BackupRepository({root:join(runtime,'repository'),coordinator:new BackupCoordinator({root:join(runtime,'checkpoints')})});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});const key=await repository.exportRecoveryPackage();await repository.verifyRecoveryPackage(key);
  const profile=join(f.root,'gitea-profile.json'),job=new GiteaBackupJob({root:join(runtime,'gitea'),repository,profile});
  const stores=new Map<string,Workspaces>();for(const user of [owner,second]){const scope='gitea-'+user.id,store=new Workspaces(join(f.root,'tasks',scope));await store.createChatConversation(user.login+'-chat');stores.set(scope,store);}
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider turns');}};
  host=new HostServer({port:0,token:'synthetic-host-token',requireUser:true,factory,backup:{personal:true,administrator:'owner',coordinator:new BackupCoordinator({root:join(runtime,'checkpoints')}),repository,gitea:job,scopes:[...stores.keys()]},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await host.start();
  const login=join(f.root,'login');await mkdir(login,{mode:0o700});const loginFile=join(login,'web.json');
  await writeFile(loginFile,JSON.stringify({giteaUrl:`http://127.0.0.1:${f.port}`,clientId:app.client_id,clientSecret:app.client_secret,publicUrl:origin,routes:Object.fromEntries([owner,second].map(user=>[String(user.id),{hostUrl:`ws://127.0.0.1:${host!.address().port}/host`,hostToken:'synthetic-host-token'}]))}),{mode:0o600});
  const startWeb=async()=>{const settings=JSON.parse(await readFile(loginFile,'utf8'));const result=new WebServer({host:'127.0.0.1',port:webPort,identity:{...settings,sharedHost:true,routes:()=>settings.routes}});await result.start();return result;};
  web=await startWeb();browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext(),page=await context.newPage();
  const signIn=async()=>{
   await page.goto(origin+'/auth/login');
   if(await page.locator('input[name="user_name"]').count()){await page.locator('input[name="user_name"]').fill('owner');await page.locator('input[name="password"]').fill('Synthetic-fixture-password-123!');await page.getByRole('button',{name:/Sign In|登录/}).click();}
   const authorize=page.getByRole('button',{name:/Authorize Application|授权应用/});if(await authorize.count())await authorize.click();
   await expect.poll(async()=>(await context.request.get(origin+'/api/me')).status(),{timeout:20000}).toBe(200);
   expect(await (await context.request.get(origin+'/api/me')).json()).toMatchObject({id:String(owner.id),login:'owner'});
   const tasks=await (await context.request.get(origin+'/api/workspace')).json();expect(tasks.conversations.map((t:{id:string})=>t.id)).toEqual(['owner-chat']);
  };
  await signIn();
  await writeFile(profile,JSON.stringify({coffee:{configurationFiles:[loginFile],bindings:[owner,second].map(user=>({accountId:String(user.id),scope:'gitea-'+user.id,projects:join(f.root,'tasks','gitea-'+user.id)}))},schema:1,url:`http://127.0.0.1:${f.port}/`,binary:f.binary,version:'1.27.3',appIni:f.config,workPath:f.work,roots:{gitea:f.work,login},checkStopped:['/usr/bin/python3',f.control,'check'],stop:['/usr/bin/python3',f.control,'stop'],start:['/usr/bin/python3',f.control,'start'],allowServicePause:true}),{mode:0o600});
  const backupResponse=await context.request.post(origin+'/api/backup',{headers:{origin},data:{action:'gitea-backup'}});expect(backupResponse.status()).toBe(200);const point=await backupResponse.json();expect(point.state).toBe('succeeded');expect(JSON.stringify(point)).not.toContain(app.client_secret);await f.ready();
  const tokenFile=join(runtime,'host-token');await writeFile(tokenFile,'synthetic-host-token',{mode:0o600});
  const runner=new BackupJobRunner({root:join(runtime,'schedule'),repository,coordinator:new BackupCoordinator({root:join(runtime,'checkpoints')})});
  await runner.configure({revision:'gitea-daily',scopes:['gitea-'+owner.id],timeZone:'UTC',hour:0,giteaProfile:profile,automaticRetention:true,host:{url:`http://127.0.0.1:${host.address().port}`,tokenFile,actor:'owner'}});
  const scheduled=await runner.tick();expect(scheduled.run?.gitea).toMatchObject({state:'succeeded'});expect(scheduled.run?.state).not.toBe('succeeded');
  const points=await repository.archivePoints('gitea');expect(points).toHaveLength(2);await runner.tick();expect(await repository.archivePoints('gitea')).toHaveLength(2);await f.ready();
  await web.close();web=undefined;await f.run('stop');await rm(f.work,{recursive:true});await rm(login,{recursive:true});await rm(join(runtime,'repository','password'));
  const retained=(await repository.archivePoints('gitea')).filter(p=>p.state==='succeeded'&&!p.retiredAt);expect(retained).toHaveLength(1);
  const restart=join(f.root,'restart-once.py');await writeFile(restart,`import pathlib,subprocess,time,sys
flag=pathlib.Path(${JSON.stringify(join(f.root,'start-failed'))})
subprocess.run(['/usr/bin/python3',${JSON.stringify(f.control)},'start'],check=True)
time.sleep(2)
if not flag.exists():
 flag.write_text('response lost after start');sys.exit(1)
`);
  const settings=JSON.parse(await readFile(profile,'utf8'));settings.start=['/usr/bin/python3',restart];await writeFile(profile,JSON.stringify(settings),{mode:0o600});
  const mismatch=structuredClone(settings);mismatch.coffee.bindings[0].projects=join(f.root,'wrong-account-root');await writeFile(profile,JSON.stringify(mismatch));
  await expect(job.preview(retained[0].id,{recoveryPackage:key})).rejects.toMatchObject({code:'gitea_restore_profile_changed'});await writeFile(profile,JSON.stringify(settings));
  const preview=await job.preview(retained[0].id,{recoveryPackage:key});expect(preview.state).toBe('staged');expect(preview.targets).toHaveLength(2);
  await expect(job.confirm(preview.id,preview.digest)).rejects.toMatchObject({code:'service_command_failed'});
  expect((await job.confirm(preview.id,preview.digest)).state).toBe('completed');await f.ready();
  expect((await f.api('user')).id).toBe(owner.id);expect((await f.api('repos/owner/notes')).name).toBe('notes');
  const content=await f.api('repos/owner/notes/contents/README.md');expect(Buffer.from(content.content,'base64').toString()).toContain('notes');
  const assets=await f.api(`repos/owner/notes/issues/${issue.number}/assets`);expect(assets.map((a:any)=>a.id)).toContain(attachment.id);
  const asset=await fetch(attachment.browser_download_url,{headers:{authorization:'Basic '+Buffer.from('owner:Synthetic-fixture-password-123!').toString('base64')}});expect(asset.status).toBe(200);expect(await asset.text()).toBe('Gitea attachment bytes');
  web=await startWeb();expect((await context.request.get(origin+'/api/me')).status()).toBe(401);await signIn();
 }finally{await browser?.close();await web?.close();await host?.close();await f.close();}
},180000);
