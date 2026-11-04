import {test,expect,vi} from 'vitest';
import type {PathLike} from 'node:fs';
import {join} from 'node:path';
import {readFile,writeFile,readdir,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {TrustedSourceAuthority} from '../src/host/trusted-source-authority.js';
import {existingPi,normalPiHandoff,crashedLocalHost,reopen} from './trusted-native-enrollment-fixture.js';

const fault=vi.hoisted(()=>{const state:{target?:string;kernelReads?:Record<string,string>}={};return state;});
vi.mock('node:fs',async importOriginal=>{
 const original=await importOriginal<typeof import('node:fs')>();
 return {...original,readFileSync:(...args:Parameters<typeof original.readFileSync>)=>{const simulated=fault.kernelReads?.[String(args[0])];if(simulated==='EACCES')throw Object.assign(Error('Synthetic kernel read denied'),{code:'EACCES'});if(simulated!==undefined)return simulated;return original.readFileSync(...args);},renameSync:(from:PathLike,to:PathLike)=>{if(String(to)===fault.target)throw Object.assign(Error('Synthetic journal rename failure'),{code:'ENOSPC'});return original.renameSync(from,to);}};
});

test('journal rename failure after a durable reconciliation receipt retains the old operation across later ordinary writes',async()=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined;
 try{
  await normalPiHandoff(f);await crashedLocalHost(f,'bootstrap');const current=await reopen(f);restarted=current.authority;const stateFile=join(f.control,'authority','state.json'),before=JSON.parse(await readFile(stateFile,'utf8'));
  fault.target=stateFile;await expect(restarted.qualifyExisting('awangs',current.options)).rejects.toThrow();fault.target=undefined;
  expect(await readdir(join(f.control,'authority','reconciliations'))).toHaveLength(1);await restarted.runWriter('host','later-ordinary-write',()=>writeFile(join(f.task.cwd,'later'),'normal work still runs'));
  const after=JSON.parse(await readFile(stateFile,'utf8'));expect(after.operations).toEqual(before.operations);expect(after.enrollment).toBeUndefined();expect(after.issues).toContain('enrollment-journal-unavailable');expect((await restarted.qualification()).state).toBe('unknown');
 }finally{fault.target=undefined;await restarted?.close();await f.cleanup();}
},40000);


async function freshAuthority(authorize:(actor:string)=>Promise<boolean>){
 const root=await mkdtemp(join(tmpdir(),'fresh-enroll-fault-')),control=join(root,'control'),source=join(root,'source');await mkdir(control,{mode:0o700});const configuration=join(control,'configuration.json'),graph=join(control,'graph.json'),lock=join(control,'group.lock'),custody=new NativeWriterCustody(join(control,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'fresh-group',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'source',path:source}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});await writeFile(graph,JSON.stringify({schema:1,groupId:'fresh-group',roots:[{id:'source',scope:'awangs',engine:'pi'}]}),{mode:0o600});
 const authority=await TrustedSourceAuthority.open({root:join(control,'authority'),configuration,graph,fence,authorize});return {root,control,source,authority,state:join(control,'authority','state.json'),cleanup:async()=>{await authority.close();await rm(root,{recursive:true,force:true});}};
}

test('fresh enrollment rename failure cannot be persisted as a qualified enrollment by a later ordinary writer',async()=>{
 const f=await freshAuthority(async actor=>actor==='awangs');try{
  fault.target=f.state;await expect(f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid}])).rejects.toThrow();fault.target=undefined;
  await f.authority.runWriter('host','ordinary-after-refusal',()=>writeFile(join(f.source,'ordinary'),'preserved'));
  const state=JSON.parse(await readFile(f.state,'utf8'));expect(state.enrollment).toBeUndefined();expect(state.issues).toContain('enrollment-journal-unavailable');expect((await f.authority.qualification()).state).toBe('unknown');expect(await readFile(join(f.source,'ordinary'),'utf8')).toBe('preserved');
 }finally{fault.target=undefined;await f.cleanup();}
});

test('fresh enrollment rechecks current administrator policy before committing newly allocated roots',async()=>{
 let calls=0;const f=await freshAuthority(async actor=>actor==='awangs'&&++calls===1);try{
  await expect(f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid}])).rejects.toThrow();expect(calls).toBe(2);expect(JSON.parse(await readFile(f.state,'utf8')).enrollment).toBeUndefined();expect((await f.authority.qualification()).state).toBe('unknown');
 }finally{await f.cleanup();}
});


test.each(['read-denied','uid-ambiguous','pid-reused'] as const)('SIMULATED kernel observation %s applies exact local-owner death rules',async mode=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined;try{
  await normalPiHandoff(f);await crashedLocalHost(f,'bootstrap');const current=await reopen(f);restarted=current.authority;const stateFile=join(f.control,'authority','state.json'),before=JSON.parse(await readFile(stateFile,'utf8')),owner=before.operations[0].localOwner.identity,prefix='/proc/'+owner.pid;
  const actual=await readFile('/proc/self/stat','utf8'),end=actual.lastIndexOf(')'),fields=actual.slice(end+2).split(' ');fields[19]=String(BigInt(owner.birth)+1n);const stat=String(owner.pid)+' '+actual.slice(actual.indexOf('('),end+1)+' '+fields.join(' '),status=(await readFile('/proc/self/status','utf8')).replace(/^Uid:.*$/m,'Uid: '+[mode==='uid-ambiguous'?owner.uid+1:owner.uid].flatMap(uid=>[uid,uid,uid,uid]).join(' '));
  // Only this dead synthetic child's kernel-read boundary is simulated. There
  // is no production PID/boot override and no real PID-reuse acceptance claim.
  fault.kernelReads={[prefix+'/stat']:mode==='read-denied'?'EACCES':stat,[prefix+'/status']:status};
  if(mode==='pid-reused'){await restarted.qualifyExisting('awangs',current.options);const after=JSON.parse(await readFile(stateFile,'utf8')),receipt=JSON.parse(await readFile(join(f.control,'authority','reconciliations',after.enrollment.reconciliation.id+'.json'),'utf8'));expect(receipt.operations[0].death.kind).toBe('process-replaced');}
  else{await expect(restarted.qualifyExisting('awangs',current.options)).rejects.toThrow();expect(JSON.parse(await readFile(stateFile,'utf8')).operations).toEqual(before.operations);expect((await restarted.qualification()).state).toBe('unknown');}
 }finally{fault.kernelReads=undefined;await restarted?.close();await f.cleanup();}
},40000);
