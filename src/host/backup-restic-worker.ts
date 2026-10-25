/** Private command supervisor. Parent must durably record this process identity
 * before granting execution. EOF before that grant never starts Restic. */
import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setPriority} from 'node:os';

// This check precedes both the execution grant and any repository parsing.
try{
 const scope=process.env.PI_COFFEE_ENGINE_SCOPE;if(!scope||!/^coffee-backup-engine-[0-9a-f-]{36}\.scope$/.test(scope))throw Error('Missing budget');
 const group=(await readFile('/proc/self/cgroup','utf8')).trim().split(':')[2];if(!group.endsWith('/'+scope))throw Error('Uncontained worker');
 const base='/sys/fs/cgroup'+group,memory=(await readFile(base+'/memory.max','utf8')).trim(),swap=(await readFile(base+'/memory.swap.max','utf8')).trim(),tasks=(await readFile(base+'/pids.max','utf8')).trim(),cpu=(await readFile(base+'/cpu.max','utf8')).trim().split(' ').map(Number),io=await readFile(base+'/io.weight','utf8').then(value=>value.trim(),error=>{if(error.code==='ENOENT')return undefined;throw error;});
 if(!Number.isSafeInteger(Number(memory))||Number(memory)>1073741824||Number(memory)<33554432||swap!=='0'||!Number.isSafeInteger(Number(tasks))||Number(tasks)>64||!cpu[0]||cpu[0]/cpu[1]>1||io!==undefined&&io!=='default 10'||execFileSync('/usr/bin/ionice',['-p',String(process.pid)],{encoding:'utf8'}).trim()!=='idle')throw Error('Budget unenforced');
 setPriority(0,15);
}catch{process.exit(1);}

let granted=false,input='';
const deadline=setTimeout(()=>process.exit(1),10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 input+=chunk;
 if(!granted&&input==='execute\n'){
  granted=true;clearTimeout(deadline);process.stdin.pause();
  const [binary,...args]=process.argv.slice(2);
  const child=spawn(binary,args,{stdio:['ignore',1,2,3],env:process.env});
  child.on('error',()=>process.exit(1));child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);process.stdin.destroy();});
 }
 if(input.length>64)process.exit(1);
});
process.stdin.on('end',()=>{if(!granted)process.exit(1);});
