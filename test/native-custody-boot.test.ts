import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const previousBoot='11111111-1111-4111-8111-111111111111';

it.each(['prepared','active','quiescent'] as const)('SIMULATED prior boot: bound schema2 %s custody is locally gone and cannot launch in this boot',async(state)=>{
 const root=await mkdtemp(join(tmpdir(),'custody-boot-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});
 try{const launch=await custody.prepare({executable:'/bin/true'}),dir=launch.env.PI_COFFEE_CUSTODY_DIR;
  const command=JSON.parse(await readFile(join(dir,'command.json'),'utf8'));expect(command.schema).toBe(2);
  // Explicit synthetic previous-boot fixture, never a production boot override.
  const text=JSON.stringify({...command,boot:previousBoot});await writeFile(join(dir,'command.json'),text);const prepared=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));await writeFile(join(dir,'state.json'),JSON.stringify({...prepared,state,boot:previousBoot,commandDigest:digest(text),...(state==='active'?{pid:999999,birth:'1'}:{}),...(state==='quiescent'?{nativeStatus:-9}:{})}));
  expect(await custody.state()).toEqual({state:'quiescent'});const cut=await fence.lease();cut.assertValid();cut.release();
  const child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'});expect((await once(child,'exit'))[0]).toBe(78);expect(JSON.parse(await readFile(join(dir,'state.json'),'utf8')).state).toBe(state);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('single-field boot corruption cannot reinterpret current prepared custody as a previous boot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'custody-boot-corrupt-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock});new PhysicalWriterFence({lock,custody});
 try{const launch=await custody.prepare({executable:'/bin/true'}),file=join(launch.env.PI_COFFEE_CUSTODY_DIR,'state.json'),receipt=JSON.parse(await readFile(file,'utf8'));await writeFile(file,JSON.stringify({...receipt,boot:previousBoot}));expect((await custody.state()).state).toBe('unknown');}
 finally{await rm(root,{recursive:true,force:true});}
});

it('single-field boot corruption cannot hide a lost current custodian with a still-live native descendant',async()=>{
 const root=await mkdtemp(join(tmpdir(),'custody-boot-orphan-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),marker=join(root,'supervisor'),release=join(root,'release'),done=join(root,'done');
 const code=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},String(process.ppid));const end=Date.now()+5000;const timer=setInterval(()=>{if(Date.now()>end||fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);fs.writeFileSync(${JSON.stringify(done)},'done');}},20);`;
 const launch=await custody.prepare({executable:process.execPath,args:['-e',code]}),child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'}),exited=once(child,'exit');
 try{await expect.poll(async()=>Number(await readFile(marker,'utf8').catch(()=>0))).toBeGreaterThan(0);process.kill(Number(await readFile(marker,'utf8')),'SIGKILL');await exited;
  const file=join(launch.env.PI_COFFEE_CUSTODY_DIR,'state.json'),receipt=JSON.parse(await readFile(file,'utf8'));await writeFile(file,JSON.stringify({...receipt,boot:previousBoot}));expect((await custody.state()).state).toBe('unknown');await expect(fence.lease()).rejects.toMatchObject({code:'writers_unknown'});
 }finally{await writeFile(release,'release');await expect.poll(async()=>readFile(done,'utf8').catch(()=>''),{timeout:6000}).toBe('done');await rm(root,{recursive:true,force:true});}
},15000);

it('legacy receipts lacking command-bound boot remain unknown across a boot boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'custody-boot-legacy-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock});new PhysicalWriterFence({lock,custody});
 try{const launch=await custody.prepare({executable:'/bin/true'}),dir=launch.env.PI_COFFEE_CUSTODY_DIR,command=JSON.parse(await readFile(join(dir,'command.json'),'utf8')),receipt=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));command.schema=1;delete command.boot;receipt.schema=1;receipt.boot=previousBoot;delete receipt.commandDigest;await writeFile(join(dir,'command.json'),JSON.stringify(command));await writeFile(join(dir,'state.json'),JSON.stringify(receipt));expect((await custody.state()).state).toBe('unknown');}
 finally{await rm(root,{recursive:true,force:true});}
});
