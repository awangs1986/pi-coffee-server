import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readdir,rm,writeFile,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
it('owns a private disk temp directory and removes it after graceful Host shutdown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-temp-lifetime-'));
 const temp=join(root,'native-tmp');await mkdir(temp);
 const child=spawn(process.execPath,['dist/src/main.js','host'],{env:{PATH:process.env.PATH,HOME:root,PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_BIND:'off',PI_COFFEE_EXTENSIONS:'off',PI_COFFEE_TMP_ROOT:temp},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');
 try {
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Host startup timed out')),10000);
   child.stdout.on('data',data=>{if(String(data).includes('Host ws:')){clearTimeout(timer);resolve();}});
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Host exited before readiness'));});
  });
  const dirs=await readdir(temp);expect(dirs).toHaveLength(1);
  const owned=join(temp,dirs[0]);
  const environment=(await readFile(`/proc/${child.pid}/environ`,'utf8')).split('\0');
  // /proc exposes the startup environment, while Host sets TMPDIR after startup.
  // Directory ownership and actual graceful cleanup are verified below.
  expect(environment).toContain('PI_COFFEE_TMP_ROOT='+temp);
  expect((await stat(owned)).mode&0o777).toBe(0o700);
  await writeFile(join(owned,'native-fixture'),'temporary content');
  child.kill('SIGTERM');await exited;
  expect(await readdir(temp)).toEqual([]);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}await rm(root,{recursive:true,force:true});}
},15000);

it('reclaims a crashed Host directory on restart without deleting a live Host directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-temp-recovery-'));const temp=join(root,'tmp');await mkdir(temp);
 const children:ReturnType<typeof spawn>[]=[];let orphan:ReturnType<typeof spawn>|undefined;
 async function start(){
  const child=spawn(process.execPath,['dist/src/main.js','host'],{env:{PATH:process.env.PATH,HOME:root,PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:join(root,'sessions-'+children.length),PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_BIND:'off',PI_COFFEE_EXTENSIONS:'off',PI_COFFEE_TMP_ROOT:temp},stdio:['ignore','pipe','pipe']});children.push(child);
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup deadline')),10000);child.stdout!.on('data',data=>{if(String(data).includes('Host ws:')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});return child;
 }
 try{
  const a=await start();const old=(await readdir(temp))[0];await writeFile(join(temp,old,'payload'),'abandoned');
  orphan=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{PATH:process.env.PATH,TMPDIR:join(temp,old)},stdio:'ignore'});await once(orphan,'spawn');
  const dead=once(a,'exit');a.kill('SIGKILL');await dead;
  await start();expect(await readFile(join(temp,old,'payload'),'utf8')).toBe('abandoned');
  const orphanExit=once(orphan,'exit');orphan.kill('SIGTERM');await orphanExit;
  await start();expect(await readdir(temp)).not.toContain(old);
  const live=(await readdir(temp))[0];await writeFile(join(temp,live,'payload'),'active');
  await start();expect(await readFile(join(temp,live,'payload'),'utf8')).toBe('active');
 }finally{if(orphan?.exitCode===null&&orphan.signalCode===null){const done=once(orphan,'exit');orphan.kill('SIGKILL');await done;}await Promise.all(children.filter(c=>c.exitCode===null&&c.signalCode===null).map(async c=>{const done=once(c,'exit');c.kill('SIGTERM');await done;}));await rm(root,{recursive:true,force:true});}
},30000);

// Exercise the configuration boundary without requiring mount privileges in CI.
it('refuses memory mode on an ordinary disk rather than silently claiming a RAM cap',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-temp-cap-'));
 const child=spawn(process.execPath,['dist/src/main.js','host'],{env:{PATH:process.env.PATH,HOME:root,PI_COFFEE_TMP_ROOT:root,PI_COFFEE_TMP_STORAGE:'memory'},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',d=>error+=String(d));
 try{const [code]=await once(child,'exit');expect(code).not.toBe(0);expect(error).toContain('private tmpfs capped at 16 GiB');}finally{await rm(root,{recursive:true,force:true});}
},10000);
