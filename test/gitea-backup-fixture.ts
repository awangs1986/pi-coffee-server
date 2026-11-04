import {expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,userInfo} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
const execute=promisify(execFile);
export async function freePort(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture port');await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;}
export async function giteaBackupFixture(){
 const binary=process.env.PI_COFFEE_TEST_GITEA;if(!binary)throw Error('Set PI_COFFEE_TEST_GITEA to the qualified Gitea 1.27.3 binary');
 const root=await mkdtemp(join(tmpdir(),'coffee-gitea-backup-')),work=join(root,'gitea'),config=join(work,'custom','conf','app.ini'),port=await freePort();
 const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:root,USER:userInfo().username,LANG:'C.UTF-8'};
 await mkdir(dirname(config),{recursive:true,mode:0o700});
 await writeFile(config,`APP_NAME = Backup Fixture\nRUN_USER = ${userInfo().username}\nRUN_MODE = prod\n[database]\nDB_TYPE = sqlite3\nPATH = ${join(work,'data','gitea.db')}\n[repository]\nROOT = ${join(work,'data','repositories')}\n[server]\nAPP_DATA_PATH = ${join(work,'data')}\nDOMAIN = 127.0.0.1\nHTTP_ADDR = 127.0.0.1\nHTTP_PORT = ${port}\nROOT_URL = http://127.0.0.1:${port}/\nDISABLE_SSH = true\n[security]\nINSTALL_LOCK = true\n[service]\nDISABLE_REGISTRATION = true\n[log]\nMODE = console\nLEVEL = Error\n`,{mode:0o600});
 const cli=(...args:string[])=>execute(binary,[...args,'--work-path',work,'--config',config],{env,timeout:60000,maxBuffer:1024*1024});
 const control=join(root,'control.py');
 await writeFile(control,`import os,sys,json,subprocess,time,signal,pathlib\nroot=pathlib.Path(${JSON.stringify(root)});state=root/'process.json'\ndef birth(pid):\n try:\n  parts=pathlib.Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split();return None if parts[0] in ('Z','X') else parts[19]\n except FileNotFoundError:return None\ndef current():\n if not state.exists():return None\n value=json.loads(state.read_text());return value if birth(value['pid'])==value['birth'] else None\naction=sys.argv[1]\nif action=='check':sys.exit(1 if current() else 0)\nif action=='stop':\n value=current()\n if value:\n  os.kill(value['pid'],signal.SIGTERM)\n  for _ in range(150):\n   if not current():break\n   time.sleep(.1)\n  if current():raise RuntimeError('Fixture process did not stop')\nelif action=='start':\n if current():sys.exit(0)\n log=open(root/'gitea.log','ab');p=subprocess.Popen(${JSON.stringify([binary,'web','--work-path',work,'--config',config])},env=${JSON.stringify(env)},stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)\n state.write_text(json.dumps({'pid':p.pid,'birth':birth(p.pid)}))\nelse:raise RuntimeError('Invalid fixture action')\n`,{mode:0o600});
 const run=(action:string)=>execute('/usr/bin/python3',[control,action],{env,timeout:30000,maxBuffer:8192});
 const ready=()=>expect.poll(async()=>fetch(`http://127.0.0.1:${port}/api/v1/version`).then(r=>r.status,()=>0),{timeout:30000,interval:200}).toBe(200);
 try{
  await cli('migrate');
  for(const name of ['owner','second'])await cli('admin','user','create','--username',name,'--password','Synthetic-fixture-password-123!','--email',name+'@example.invalid','--must-change-password=false',...(name==='owner'?['--admin']:[]));
  await run('start');await ready();
  const api=async(path:string,body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${port}/api/v1/${path}`,{method:body?'POST':'GET',headers:{authorization:'Basic '+Buffer.from('owner:Synthetic-fixture-password-123!').toString('base64'),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error('Fixture Gitea API '+response.status);return data;};
  return {root,work,config,binary,port,api,run,ready,control,env,close:async()=>{await run('stop');await rm(root,{recursive:true,force:true});}};
 }catch(error){await run('stop').catch(()=>undefined);await rm(root,{recursive:true,force:true});throw error;}
}
