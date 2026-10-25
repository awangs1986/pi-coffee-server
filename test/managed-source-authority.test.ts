import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ManagedSourceAuthority,startManagedAdmissionControl} from '../src/host/managed-source-authority.js';
import {ManagedLaunchPolicy,LegacyAdmissionFence} from '../src/host/managed-launch-policy.js';
import {AdmissionNativeCustody} from '../src/host/native-custody.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {Workspaces} from '../src/host/workspaces.js';

async function request(path:string){const socket=createConnection(path);try{await once(socket,'connect');socket.write(JSON.stringify({schema:1,operation:'retire-unrestricted',challenge:'fresh-synthetic-challenge'})+'\n');let text='';for await(const part of socket){text+=String(part);if(text.includes('\n'))return JSON.parse(text.split('\n')[0]);}throw Error('No handoff response');}finally{socket.destroy();}}

it('live unrestricted retirement denies future launches but waits for real native natural exit before issuing handoff',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-source-control-')),control=join(root,'control'),marker=join(root,'started'),release=join(root,'release');await mkdir(control,{mode:0o755});
 const policy=new ManagedLaunchPolicy(),custody=new AdmissionNativeCustody(join(root,'custody'),policy),launch=await custody.prepare({executable:process.execPath,args:['-e',`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'alive');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0);}},20);`]});
 const child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'}),done=once(child,'exit'),socket=join(control,'admission.sock');let server:Awaited<ReturnType<typeof startManagedAdmissionControl>>|undefined;
 try{await expect.poll(()=>readFile(marker,'utf8').catch(()=>''),{timeout:5000}).toBe('alive');server=await startManagedAdmissionControl({socket,allowedUid:process.getuid!(),policy,custody});expect(await request(socket)).toMatchObject({error:'managed-authority-unavailable'});await expect(custody.prepare({executable:process.execPath})).rejects.toThrow();expect(child.exitCode).toBeNull();await writeFile(release,'natural');await done;await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');const handoff=await request(socket);expect(handoff).toMatchObject({schema:1,challenge:'fresh-synthetic-challenge',admission:'protected-only',legacy:'drained',authority:{pid:process.pid,uid:process.getuid!()}});expect(handoff.authority.birth).toMatch(/^\d+$/);expect(handoff.policyRevision).toBeGreaterThan(0);
 }finally{await writeFile(release,'natural');await done;await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());await rm(root,{recursive:true,force:true});}
},15000);

it('managed source qualification rejects same-UID keys and an uninstalled dedicated executor identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-source-unqualified-')),uid=process.getuid!(),config={schema:1 as const,executorUid:uid,legacyHostUid:uid+1,keyUid:uid,sourceParent:root,sourceSocket:join(root,'source.sock'),legacyAdmissionSocket:join(root,'legacy.sock'),runtimeRoots:[]};
 try{expect(()=>new ManagedSourceAuthority(config)).toThrow();const authority=new ManagedSourceAuthority({...config,executorUid:uid+2,keyUid:uid+3});await expect(authority.activate()).rejects.toThrow();expect(await authority.sourceProof('awangs')).toEqual({known:false,reason:'managed-source-prerequisites-unqualified'});}finally{await rm(root,{recursive:true,force:true});}
});

it('listing unconfigured deferred engines does not enter a native execution admission or poison enrollment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-engine-discovery-')),workspaces=new Workspaces(join(root,'projects')),calls:string[]=[];
 const pi={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model execution');}},factory=new NativeAgentFactory({pi,workspaces,beforeNativeExecution:async engine=>{calls.push(engine);throw Error('Native launch must not happen');}});
 try{await factory.engines();expect(calls).toEqual([]);}finally{await rm(root,{recursive:true,force:true});}
});

it('retirement waits for already admitted platform writes and denies new ones without cancelling existing work',()=>{
 const policy=new ManagedLaunchPolicy(),fence=new LegacyAdmissionFence(policy,{writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true})}),finish=fence.beginWriter('platform');
 expect(policy.requestProtectedOnly()).toMatchObject({admission:'draining',legacy:'active'});expect(()=>fence.beginWriter('platform')).toThrow();expect(()=>fence.beginWriter('native')).toThrow();finish();expect(policy.assertProtectedOnly()).toMatchObject({admission:'protected-only',legacy:'drained'});
});
