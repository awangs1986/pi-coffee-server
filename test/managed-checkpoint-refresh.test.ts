import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {BackupCoordinator} from '../src/host/backup.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {ManagedWriterFence} from '../src/host/managed-writer-fence.js';
import {ManagedCheckpointRefresh} from '../src/host/managed-checkpoint-refresh.js';

it('automatic source refresh waits through live native writers, seals after natural exit and refreshes changed data without manual capture',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-auto-checkpoint-')),source=join(root,'source'),authority=join(root,'authority');await mkdir(source,{mode:0o700});await mkdir(authority,{mode:0o700});await writeFile(join(source,'note'),'old');
 const lock=join(authority,'group.lock'),custody=new ManagedNativeCustody(join(authority,'custody'),{sourceParent:root,lock,sources:[{path:source,destination:'/coffee/source'}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:'/coffee/source',PATH:'/usr/bin:/bin'},cwd:'/coffee/source'}),fence=new ManagedWriterFence({lock,custody});
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),adapter:{version:'synthetic-native-v1',resolve:async()=>({groupId:'native-group',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['task']}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:source},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'native',recoveryKey:'native-session/task',role:'native',data:Buffer.from('synthetic native boundary')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}}),refresh=new ManagedCheckpointRefresh({coordinator,revision:()=>fence.changeRevision,qualified:async()=>true,tasks:async()=>[{scope:'awangs',taskId:'task',engine:'pi'}],intervalMs:20,refreshMs:3600000});
 const lifetime=fence.beginWriter('native'),launch=await custody.prepare({executable:process.execPath,args:['-e',"const fs=require('node:fs');fs.writeFileSync('/coffee/source/ready','yes');const t=setInterval(()=>{if(fs.existsSync('/coffee/source/release')){fs.writeFileSync('/coffee/source/note','natural-final');clearInterval(t);}},10);"]}),child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'}),done=once(child,'exit');
 try{await expect.poll(()=>readFile(join(source,'ready'),'utf8').catch(()=>''),{timeout:5000}).toBe('yes');refresh.start();await expect.poll(async()=>(await coordinator.status('awangs','task','pi')).state).toBe('waiting');expect(await coordinator.sealedCheckpoint('awangs','task')).toBeUndefined();expect(child.exitCode).toBeNull();await writeFile(join(source,'release'),'natural');await done;lifetime();await expect.poll(async()=>(await coordinator.status('awangs','task','pi')).checkpointId,{timeout:5000}).not.toBeNull();const first=(await coordinator.sealedCheckpoint('awangs','task'))!;expect(await readFile(join(first.directory,'objects','workspace','note'),'utf8')).toBe('natural-final');
  await refresh.tick();expect((await coordinator.status('awangs','task','pi')).checkpointId).toBe(first.manifest.checkpointId);const release=fence.beginWriter('platform');await writeFile(join(source,'note'),'explicit later work');release();await expect.poll(async()=>(await coordinator.status('awangs','task','pi')).checkpointId,{timeout:5000}).not.toBe(first.manifest.checkpointId);const latest=(await coordinator.sealedCheckpoint('awangs','task'))!;expect(await readFile(join(latest.directory,'objects','workspace','note'),'utf8')).toBe('explicit later work');
 }finally{await refresh.close();await writeFile(join(source,'release'),'natural');await done;lifetime();await rm(root,{recursive:true,force:true});}
},15000);
