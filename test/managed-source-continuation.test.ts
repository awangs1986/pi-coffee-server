import {it,expect} from 'vitest';
import {mkdtemp,mkdir,lstat,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ManagedSourceContinuation,type QualifiedSourceIdentity} from '../src/host/managed-source-continuation.js';
import {ManagedSourceAuthority} from '../src/host/managed-source-authority.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
it('a real process restart continues only the same previously qualified isolated inodes and refuses replacement or newly added roots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-continuation-')),source=join(root,'source');await mkdir(source,{mode:0o700});const stat=await lstat(source),identity:QualifiedSourceIdentity={profileDigest:'synthetic-fixed-profile',paths:[{path:source,dev:stat.dev,ino:stat.ino,uid:stat.uid,directory:true}]},path=join(root,'source-qualification.json'),module=new URL('../dist/src/host/managed-source-continuation.js',import.meta.url).href;
 try{const first=spawn(process.execPath,['--input-type=module','-e',`import{ManagedSourceContinuation}from ${JSON.stringify(module)};await new ManagedSourceContinuation(${JSON.stringify(path)}).record(${JSON.stringify(identity)});`],{stdio:'pipe'});expect((await once(first,'exit'))[0]).toBe(0);const continuation=new ManagedSourceContinuation(path);await continuation.verify(identity);await expect(continuation.record(identity)).rejects.toThrow();await expect(continuation.verify({...identity,profileDigest:'changed-grants'})).rejects.toThrow();await rename(source,source+'-original');await mkdir(source,{mode:0o700});await expect(continuation.verify(identity)).rejects.toThrow();}finally{await rm(root,{recursive:true,force:true});}
});
it('qualification freezes the registered scope inventory before its first asynchronous check',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-register-')),uid=process.getuid!(),authority=new ManagedSourceAuthority({schema:1,executorUid:uid+1,legacyHostUid:uid+2,keyUid:uid+3,sourceParent:root,sourceSocket:join(root,'source.sock'),legacyAdmissionSocket:join(root,'legacy.sock'),runtimeRoots:[]}),custody=new ManagedNativeCustody(join(root,'custody'),{sourceParent:root,lock:join(root,'lock'),sources:[],runtimeRoots:[],environment:{},cwd:'/source'});
 try{authority.register('synthetic-alice',custody);const activation=authority.activate();expect(()=>authority.register('synthetic-bob',custody)).toThrow();await expect(activation).rejects.toThrow();}finally{await rm(root,{recursive:true,force:true});}
});
