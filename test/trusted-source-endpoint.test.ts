import {it,expect} from 'vitest';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {TrustedSealedCheckpointSource} from '../src/host/trusted-sealed-source.js';
import {LEGACY_BACKUP_SCOPE} from '../src/host/backup.js';
async function fixture(){
 const root=await mkdtemp('/tmp/source-endpoint-'),socket=join(root,'source.sock'),policyFile=join(root,'policy.json'),raw=await readFile('/proc/'+process.pid+'/stat','utf8');
 await writeFile(policyFile,JSON.stringify({schema:1,revision:1,administrator:'awangs',scopes:[LEGACY_BACKUP_SCOPE],actors:{awangs:{role:'administrator',scopes:[LEGACY_BACKUP_SCOPE]}},sourceProducers:[{listener:{pid:process.pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]},workerCommand:[process.execPath,'/synthetic/worker','/synthetic/config']}]}),{mode:0o600});
 const source=()=>new TrustedSealedCheckpointSource({socket,policyFile,coordinator:{sealedCheckpoint:async()=>undefined}});return {root,socket,policyFile,source};
}
it('a real source process killed after startup leaves an owned endpoint that the next source safely reclaims',async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined,next:TrustedSealedCheckpointSource|undefined;
 try{
  const program=`import {TrustedSealedCheckpointSource} from ${JSON.stringify(resolve('dist/src/host/trusted-sealed-source.js'))};const source=new TrustedSealedCheckpointSource({socket:${JSON.stringify(f.socket)},policyFile:${JSON.stringify(f.policyFile)},coordinator:{sealedCheckpoint:async()=>undefined}});await source.listen();console.log('ready');`;
  child=spawn(process.execPath,['--input-type=module','-e',program],{env:{PATH:process.env.PATH,HOME:f.root},stdio:['ignore','pipe','pipe']});let output='';child.stdout!.on('data',chunk=>output+=chunk);child.stderr!.on('data',chunk=>output+=chunk);await expect.poll(()=>output,{timeout:5000}).toContain('ready');const old=await lstat(f.socket),exit=once(child,'exit');child.kill('SIGKILL');await exit;expect((await lstat(f.socket)).ino).toBe(old.ino);
  next=f.source();await next.listen();expect((await lstat(f.socket)).isSocket()).toBe(true);expect(JSON.parse(await readFile(join(f.root,'.source.sock.authority','owner.json'),'utf8')).owner.pid).toBe(process.pid);await next.close();next=undefined;expect(await lstat(f.socket).then(()=>true,()=>false)).toBe(false);
 }finally{await next?.close();if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}await rm(f.root,{recursive:true,force:true});}
},10000);
it('a live source and an unknown stale socket are never unlinked by a second source startup',async()=>{
 const f=await fixture(),first=f.source(),second=f.source();try{
  await first.listen();const live=await lstat(f.socket);await expect(second.listen()).rejects.toThrow();expect((await lstat(f.socket)).ino).toBe(live.ino);await first.close();
  execFileSync('/usr/bin/python3',['-c','import socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.close()',f.socket]);const unknown=await lstat(f.socket);await expect(second.listen()).rejects.toThrow();expect((await lstat(f.socket)).ino).toBe(unknown.ino);
 }finally{await first.close();await second.close();await rm(f.root,{recursive:true,force:true});}
});
