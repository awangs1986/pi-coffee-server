import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,symlink,writeFile,readFile,chmod,link,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ManagedSourceAuthority} from '../src/host/managed-source-authority.js';
import {startColdEnrollmentControl} from '../src/host/cold-enrollment-control.js';
import {createConnection} from 'node:net';
import {once} from 'node:events';
import {AccountRecoveryCoordinator} from '../src/host/account-recovery.js';
import {RestoreCoordinator} from '../src/host/restore.js';
it('maintenance socket overrides cannot escape the actual unmounted authority through traversal or a symlink into a native scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cold-control-path-')),authorityRoot=join(root,'authority'),scope=join(root,'scopes');await mkdir(authorityRoot,{mode:0o700});await mkdir(scope,{mode:0o700});await symlink(scope,join(authorityRoot,'native-alias'));const uid=process.getuid!(),authority=new ManagedSourceAuthority({schema:1,executorUid:uid,legacyHostUid:uid+1,keyUid:uid+2,sourceParent:root,sourceSocket:join(root,'source.sock'),legacyAdmissionSocket:join(root,'legacy.sock'),runtimeRoots:[]}),base={profile:join(root,'must-not-be-read.json'),authority,accounts:{} as never,broker:{} as never};
 try{await expect(startColdEnrollmentControl({...base,socket:authorityRoot+'/../scopes/maintenance.sock'})).rejects.toThrow('enrollment_control_unsafe');await expect(startColdEnrollmentControl({...base,socket:join(authorityRoot,'native-alias','maintenance.sock')})).rejects.toThrow('unsafe_directory');}finally{await rm(root,{recursive:true,force:true});}
});

async function controlFixture(executorUid=process.getuid!()){
 const root=await mkdtemp(join(tmpdir(),'cold-control-software-')),uid=process.getuid!(),directory=join(root,'authority');await mkdir(directory,{mode:0o700});
 // This actual authority is deliberately never activated: tests must observe
 // writers_unknown, not replace sourceProof or manufacture a qualified export.
 const authority=new ManagedSourceAuthority({schema:1,executorUid,legacyHostUid:uid+1,keyUid:uid+2,sourceParent:root,sourceSocket:join(root,'source.sock'),legacyAdmissionSocket:join(root,'legacy.sock'),runtimeRoots:[]}),profile=join(directory,'profile.json'),socket=join(directory,'maintenance.sock'),configured={schema:1,actor:'awangs',root:join(directory,'operations'),exportDirectory:join(root,'not-an-export'),legacy:{socket:join(root,'legacy.sock'),uid:uid+1},mappings:[{scope:'alice',taskId:'task',roots:[{from:join(root,'legacy'),to:join(root,'scopes','alice')}]}]};await writeFile(profile,JSON.stringify(configured),{mode:0o600});
 const scope=async()=>{throw Error('Unqualified control must never prepare native scope');},authorize=async()=>false,restore=new RestoreCoordinator({root:join(directory,'children'),scope,authorize}),accounts=new AccountRecoveryCoordinator({root:join(directory,'accounts'),restore,scope,authorize}),options={socket,profile,authority,accounts,broker:{schema:1 as const,socket:join(root,'key.sock'),serviceUid:uid+2,actor:'awangs',dataScope:'alice',authorityRevision:1}};
 const call=async(input:unknown)=>{const connection=createConnection(socket);try{await once(connection,'connect');connection.write(JSON.stringify(input)+'\n');let response='';for await(const part of connection){response+=String(part);if(response.includes('\n'))return JSON.parse(response.split('\n')[0]);}throw Error('Missing maintenance response');}finally{connection.destroy();}};
 return {root,directory,options,profile,configured,socket,call,close:()=>rm(root,{recursive:true,force:true})};
}

it('cold control refuses public, linked, symlinked or extended profiles before opening its maintenance socket',async()=>{
 const f=await controlFixture();try{await chmod(f.profile,0o644);await expect(startColdEnrollmentControl(f.options)).rejects.toMatchObject({code:'enrollment_profile_unsafe'});await chmod(f.profile,0o600);
  const alias=join(f.directory,'profile-link.json');await link(f.profile,alias);await expect(startColdEnrollmentControl(f.options)).rejects.toMatchObject({code:'enrollment_profile_unsafe'});await rm(alias);await symlink(f.profile,alias);await expect(startColdEnrollmentControl({...f.options,profile:alias})).rejects.toMatchObject({code:'enrollment_profile_unsafe'});await rm(alias);
  await writeFile(f.profile,JSON.stringify({...f.configured,keyRoot:'/must-never-be-accepted'}));await expect(startColdEnrollmentControl(f.options)).rejects.toMatchObject({code:'enrollment_profile_unsafe'});await expect(stat(f.socket)).rejects.toMatchObject({code:'ENOENT'});await expect(stat(f.configured.root)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.close();}
});

it('actual cold Unix control rechecks its fixed private profile, refuses caller paths and cannot proceed with unqualified source custody',async()=>{
 const f=await controlFixture();let server:Awaited<ReturnType<typeof startColdEnrollmentControl>>|undefined;try{server=await startColdEnrollmentControl(f.options);const original=await readFile(f.profile,'utf8');
  for(const action of ['plan','status','approve','publish'])expect(await f.call({schema:1,action,id:'11111111-1111-4111-8111-111111111111',revision:1,digest:'0'.repeat(64)})).toEqual({schema:1,ok:false,error:{code:'writers_unknown'}});
  const response=await f.call({schema:1,action:'plan',path:'/synthetic-private-input',actor:'awangs',qualified:true});expect(response).toEqual({schema:1,ok:false,error:{code:'invalid_enrollment_request'}});expect(JSON.stringify(response)).not.toContain('/synthetic-private-input');expect(await f.call({schema:1,action:'plan',_peer:{uid:0}})).toEqual({schema:1,error:'managed-authority-unavailable'});
  await chmod(f.profile,0o644);expect(await f.call({schema:1,action:'plan'})).toEqual({schema:1,ok:false,error:{code:'enrollment_profile_unsafe'}});await chmod(f.profile,0o600);await writeFile(f.profile,JSON.stringify({...f.configured,actor:'changed-actor'}));expect(await f.call({schema:1,action:'plan'})).toEqual({schema:1,ok:false,error:{code:'enrollment_profile_changed'}});await writeFile(f.profile,original);expect(await f.call({schema:1,action:'plan'})).toEqual({schema:1,ok:false,error:{code:'writers_unknown'}});
  await expect(stat(f.configured.root)).rejects.toMatchObject({code:'ENOENT'});await expect(stat(join(f.directory,'accounts'))).rejects.toMatchObject({code:'ENOENT'});await expect(stat(join(f.directory,'children'))).rejects.toMatchObject({code:'ENOENT'});await expect(stat(f.options.broker.socket)).rejects.toMatchObject({code:'ENOENT'});
 }finally{if(server)await new Promise<void>(done=>server!.close(()=>done()));await f.close();}
});

it('cold maintenance authorization uses the actual kernel peer UID before accepting an administrator-shaped body',async()=>{
 const f=await controlFixture(process.getuid!()+3),accepted:import('node:net').Socket[]=[];let server:Awaited<ReturnType<typeof startColdEnrollmentControl>>|undefined;try{server=await startColdEnrollmentControl(f.options);server.on('connection',socket=>accepted.push(socket));expect(await f.call({schema:1,action:'plan',actor:'awangs'})).toEqual({schema:1,error:'managed-authority-unavailable'});await expect(stat(f.configured.root)).rejects.toMatchObject({code:'ENOENT'});
  await expect.poll(()=>new Promise<number>((done,fail)=>server!.getConnections((error,count)=>error?fail(error):done(count))),{timeout:1000}).toBe(0);
 }finally{for(const socket of accepted)socket.destroy();if(server)await new Promise<void>(done=>server!.close(()=>done()));await f.close();}
});
