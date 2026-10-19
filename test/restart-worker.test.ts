import {createServer,type Server} from 'node:http';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
const exec=promisify(execFile);let root:string,server:Server;
afterEach(async()=>{await new Promise<void>(done=>server?server.close(()=>done()):done());if(root)await rm(root,{recursive:true,force:true});});
async function fixture(failHost=false){
 root=await mkdtemp(join(tmpdir(),'coffee-restart-worker-'));const id=randomUUID(),now=Date.now();
 const op={id,owner:'login:owner',phase:'scheduled',createdAt:now,updatedAt:now};
 for(const file of ['operation.json','request.json'])await writeFile(join(root,file),JSON.stringify(op),{mode:0o600});
 const program=join(root,'service.mjs');await writeFile(program,`import {appendFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const [root,step]=process.argv.slice(2);appendFileSync(join(root,'log'),step+'\\n');if(step==='host')writeFileSync(join(root,'host-ready'),'1');if(step==='web')writeFileSync(join(root,'web-ready'),'1');`);
 server=createServer((req,res)=>{const role=req.url==='/healthz?role=host'?'host':'web';if(!existsSync(join(root,role+'-ready'))||(failHost&&role==='host')){res.writeHead(503).end();return;}res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ok:true,role}));});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;
 const command=(step:string)=>[process.execPath,program,root,step];
 const config=join(root,'config.json');await writeFile(config,JSON.stringify({stateDir:root,healthTimeoutSeconds:1,targets:['host','web'].map(role=>({role,restart:command(role),pause:command('pause-'+role),resume:command('resume-'+role),healthUrl:`http://127.0.0.1:${port}/healthz?role=${role}`}))}),{mode:0o600});
 const run=()=>exec('python3',[resolve('scripts/restart-worker.py'),'--config',config]);
 return {id,run,status:async()=>JSON.parse(await readFile(join(root,'operation.json'),'utf8'))};
}
it('restarts Host before Web, resumes both watchdogs and never re-executes a consumed request',async()=>{
 const f=await fixture();await f.run();expect(await f.status()).toMatchObject({id:f.id,phase:'succeeded'});
 const log=await readFile(join(root,'log'),'utf8');expect(log.trim().split('\n')).toEqual(['pause-host','pause-web','host','web','resume-web','resume-host']);
 await f.run();expect(await readFile(join(root,'log'),'utf8')).toBe(log);
});
it('stops after failed Host health, records failure and resumes paused watchdogs',async()=>{
 const f=await fixture(true);await expect(f.run()).rejects.toThrow();expect(await f.status()).toMatchObject({phase:'failed',reason:'step_failed'});
 expect((await readFile(join(root,'log'),'utf8')).trim().split('\n')).toEqual(['pause-host','pause-web','host','resume-web','resume-host']);
 await f.run();expect((await readFile(join(root,'log'),'utf8')).split('\n').filter(x=>x==='host')).toHaveLength(1);
});
it('records an interrupted prior attempt instead of repeating unknown service actions',async()=>{
 const f=await fixture(),op=await f.status();await writeFile(join(root,'operation.json'),JSON.stringify({...op,phase:'running'}),{mode:0o600});
 await expect(f.run()).rejects.toThrow();expect(await f.status()).toMatchObject({phase:'failed',reason:'interrupted_attempt'});expect(existsSync(join(root,'log'))).toBe(false);
 await f.run();expect(existsSync(join(root,'log'))).toBe(false);
});
it('reconciles a terminal current state with a stranded receipt without executing services again',async()=>{
 const f=await fixture(),op=await f.status();await mkdir(join(root,'receipts'),{mode:0o700});await writeFile(join(root,'receipts',f.id+'.json'),JSON.stringify({...op,phase:'running'}),{mode:0o600});
 await writeFile(join(root,'operation.json'),JSON.stringify({...op,phase:'succeeded'}),{mode:0o600});await f.run();
 expect(JSON.parse(await readFile(join(root,'receipts',f.id+'.json'),'utf8'))).toMatchObject({phase:'succeeded'});expect(existsSync(join(root,'log'))).toBe(false);
});
it('rejects a symlinked receipt directory before any service or outside-file mutation',async()=>{
 const f=await fixture(),outside=join(root,'outside');await mkdir(outside);
 const file=join(outside,f.id+'.json');await writeFile(file,'protected',{mode:0o400});await symlink(outside,join(root,'receipts'));
 await expect(f.run()).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('protected');expect(existsSync(join(root,'log'))).toBe(false);
});
