import {it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runnerInvocation,runRunner} from '../src/host/runner-ssh.js';
const runner={id:'test',name:'Test',host:'localhost',port:2222,username:'test',platform:'linux' as const,workdir:"/tmp/a' b"};
it('quotes POSIX workdirs, encodes PowerShell commands and keeps SFTP paths as individual arguments',()=>{
 const linux=runnerInvocation(runner,'/private/known_hosts',{kind:'exec',command:'printf hello; exit 7'},false);
 expect(linux.args.at(-1)).toBe("cd -- '/tmp/a'\\'' b' && sh -lc 'printf hello; exit 7'");
 expect(linux.args).toContain('BatchMode=yes');expect(linux.args).toContain('StrictHostKeyChecking=accept-new');
 const windows=runnerInvocation({...runner,platform:'windows',workdir:"C:\\Test O'Brien"},'/private/known_hosts',{kind:'exec',command:'Write-Output "hello"; exit 9'},true);
 const script=Buffer.from(windows.args.at(-1)!.split(' ').at(-1)!,'base64').toString('utf16le');
 expect(script).toContain("Set-Location -LiteralPath 'C:\\Test O''Brien'");expect(script).toContain('exit 9');
 const upload=runnerInvocation(runner,'/private/known_hosts',{kind:'upload',local:'-local.txt',remote:'/tmp/a b.txt'},false);
 expect(upload.program).toBe('scp');expect(upload.args.at(-1)).toBe('test@localhost:/tmp/a b.txt');expect(upload.args).not.toContain('-O');
 expect(()=>runnerInvocation(runner,'/private/known_hosts',{kind:'download',local:'out',remote:'-bad'},false)).toThrow('absolute');
});
it('passes passwords on a private fd, returns command exit status and never puts the password in argv/environment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'runner-ssh-'));const log=join(root,'log');
 const script=`#!${process.execPath}\nconst fs=require('fs');const args=process.argv.slice(2);fs.writeFileSync(process.env.RUNNER_TEST_LOG,JSON.stringify({args,password:fs.readFileSync(3,'utf8'),environment:Object.values(process.env)}));process.stdout.write('output');process.stderr.write('error');process.exit(7);`;
 await writeFile(join(root,'sshpass'),script,{mode:0o700});vi.stubEnv('PATH',root+':'+process.env.PATH);vi.stubEnv('RUNNER_TEST_LOG',log);
 try{
  const result=await runRunner(runner,'fixture-secret',join(root,'known_hosts'),{kind:'exec',command:'exit 7'});expect(result).toEqual({code:7,stdout:'output',stderr:'error'});
  const recorded=JSON.parse(await readFile(log,'utf8'));expect(recorded.args.slice(0,3)).toEqual(['-d','3','ssh']);expect(recorded.password).toBe('fixture-secret\n');expect(recorded.args.join(' ')).not.toContain('fixture-secret');expect(recorded.environment).not.toContain('fixture-secret');
 }finally{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
});
it('bounds output and terminates descendants holding inherited output pipes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'runner-process-tree-'));
 await writeFile(join(root,'ssh'),`#!${process.execPath}\nrequire('child_process').spawn(process.execPath,['-e',"process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000)"],{stdio:'inherit'});setInterval(()=>{},1000);`,{mode:0o700});
 vi.stubEnv('PATH',root+':'+process.env.PATH);
 try{await expect(runRunner(runner,undefined,join(root,'known_hosts'),{kind:'exec',command:'ignored'})).rejects.toThrow('exceeded');}
 finally{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
},5000);
it('cleans real sshpass descendants even when they ignore the PTY hangup',async()=>{
 const {existsSync}=await import('node:fs');if(!existsSync('/usr/bin/sshpass'))return;
 const root=await mkdtemp(join(tmpdir(),'runner-real-sshpass-')),pidfile=join(root,'pid');
 await writeFile(join(root,'ssh'),`#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));process.on('SIGHUP',()=>{});process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000);`,{mode:0o700});
 vi.stubEnv('PATH',root+':/usr/bin:'+process.env.PATH);
 try{
  await expect(runRunner(runner,'fixture-secret',join(root,'known_hosts'),{kind:'exec',command:'ignored'})).rejects.toThrow('exceeded');
  const pid=Number(await readFile(pidfile,'utf8'));await new Promise(r=>setTimeout(r,100));
  // An unreaped zombie is already dead; an executing process must not remain.
  let state='gone';try{state=(await readFile(`/proc/${pid}/stat`,'utf8')).split(' ')[2];}catch{}
  expect(['gone','Z']).toContain(state);
 }finally{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
},5000);
