import {it,expect} from 'vitest';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
it('refuses engine execution unless the independent worker resource scope is actually enforced',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-engine-refusal-'));try{
  const marker=join(root,'executed'),child=spawn(process.execPath,[resolve('dist/src/host/backup-restic-worker.js'),process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'unsafe')`],{stdio:['pipe','ignore','ignore','ignore'],env:{PI_COFFEE_ENGINE_SCOPE:'coffee-backup-engine-'+randomUUID()+'.scope'}});child.stdin.end('execute\n');
  expect((await once(child,'exit'))[0]).not.toBe(0);await expect(stat(marker)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('contains a synthetic memory-hungry engine in an independent capped scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-engine-budget-'));try{
  const scope='coffee-backup-engine-'+randomUUID()+'.scope',marker=join(root,'budget');
  const code=`const fs=require('fs');const group=fs.readFileSync('/proc/self/cgroup','utf8').trim().split(':')[2];const base='/sys/fs/cgroup'+group;fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({group,memoryMax:fs.readFileSync(base+'/memory.max','utf8').trim(),pidsMax:fs.readFileSync(base+'/pids.max','utf8').trim()}));const data=[];for(let i=0;i<32;i++)data.push(Buffer.alloc(16*1024*1024,1));fs.writeFileSync(${JSON.stringify(marker+'-escaped')},'escaped');`;
  const child=spawn('/usr/bin/systemd-run',['--user','--scope','--quiet','--collect','--expand-environment=no','--unit='+scope,'--property=MemoryMax=128M','--property=MemorySwapMax=0','--property=CPUQuota=100%','--property=TasksMax=64','--property=IOWeight=10','/usr/bin/ionice','-c3',process.execPath,resolve('dist/src/host/backup-restic-worker.js'),process.execPath,'-e',code],{stdio:['pipe','ignore','ignore','ignore'],env:{PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS,PI_COFFEE_ENGINE_SCOPE:scope}});child.stdin.end('execute\n');
  expect((await once(child,'exit'))[0]).not.toBe(0);const evidence=JSON.parse(await readFile(marker,'utf8'));expect(evidence.group.endsWith('/'+scope)).toBe(true);expect(evidence.memoryMax).toBe('134217728');expect(evidence.pidsMax).toBe('64');await expect(stat(marker+'-escaped')).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
