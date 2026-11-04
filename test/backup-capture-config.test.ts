import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {resolve,join} from 'node:path';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
it('refuses invalid trusted capture bounds at real Host startup before opening listeners',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-capture-config-'));
 try{
  const child=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_AGENT_DIR:join(root,'agent'),PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_BIND:'off',PI_COFFEE_EXTENSIONS:'off',PI_COFFEE_BACKUP_MAX_BYTES:'-1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const exited=Promise.race([once(child,'exit'),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Host accepted invalid capture bound'));},10000);timer.unref();child.once('exit',()=>clearTimeout(timer));})]);expect((await exited)[0]).toBe(1);expect(output).toContain('PI_COFFEE_BACKUP_MAX_BYTES');expect(output).not.toContain('Host ws://');
 }finally{await rm(root,{recursive:true,force:true});}
},15000);
