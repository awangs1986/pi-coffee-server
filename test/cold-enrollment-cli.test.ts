import {it,expect} from 'vitest';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
it('the installed maintenance CLI sends only the reviewed operation identity to its actual authenticated Unix peer and refuses arbitrary path options',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cold-cli-')),socket=join(root,'maintenance.sock'),client=join(root,'client.json'),seen:unknown[]=[];await writeFile(client,JSON.stringify({schema:1,socket,sourceUid:process.getuid!()}),{mode:0o600});const server=createServer(connection=>{let buffer='';connection.on('data',bytes=>{buffer+=String(bytes);if(!buffer.includes('\n'))return;seen.push(JSON.parse(buffer.split('\n')[0]));connection.end(JSON.stringify({schema:1,ok:true,result:{state:'staged',digest:'reviewed-digest'}})+'\n');});});server.listen(socket);await once(server,'listening');await chmod(socket,0o660);
 const cli=new URL('../dist/src/cold-enrollment-cli.js',import.meta.url).pathname,run=async(args:string[])=>{const child=spawn(process.execPath,[cli,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=String(data));child.stderr.on('data',data=>stderr+=String(data));const [code]=await once(child,'exit');return {code,stdout,stderr};};
 try{const result=await run(['approve','--client',client,'--id','11111111-1111-4111-8111-111111111111','--revision','1','--digest','approved-digest']);expect(result.code,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual({state:'staged',digest:'reviewed-digest'});expect(seen).toEqual([{schema:1,action:'approve',id:'11111111-1111-4111-8111-111111111111',revision:1,digest:'approved-digest'}]);expect((await run(['plan','--client',client,'--path','/any/path'])).code).toBe(1);expect(seen).toHaveLength(1);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
