/** Operator entry point; no source secret is accepted on argv or in the environment. */
import {spawn} from 'node:child_process';import {readFile,open,lstat} from 'node:fs/promises';import {isAbsolute} from 'node:path';
import {BackupRepositoryClient} from './host/backup-repository-client.js';import {BackupBrokerError} from './host/backup-key-protocol.js';
const args=process.argv.slice(2),command=args.shift(),options=new Map<string,string>();
try{
 if(args.length%2)throw new BackupBrokerError('invalid_cli_request');for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||options.has(args[i]))throw new BackupBrokerError('invalid_cli_request');options.set(args[i],args[i+1]);}
 const required=(key:string)=>{const value=options.get('--'+key);if(!value)throw new BackupBrokerError('invalid_cli_request');return value;};
 if(command==='serve'){
  const config=required('config');if(!isAbsolute(config))throw new BackupBrokerError('invalid_cli_request');
  const child=spawn('/usr/bin/python3',[new URL('./host/backup-unix-peer.py',import.meta.url).pathname,'serve',config],{stdio:['ignore','ignore','ignore'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS}});process.once('SIGTERM',()=>child.kill('SIGTERM'));process.once('SIGINT',()=>child.kill('SIGINT'));process.exitCode=await new Promise<number>(resolve=>{child.once('error',()=>resolve(1));child.once('close',code=>resolve(code??1));});
 }else{
  const client=new BackupRepositoryClient({socket:required('socket'),serviceUid:Number(required('service-uid')),actor:required('actor'),dataScope:required('data-scope'),authorityRevision:Number(required('revision'))});
  switch(command){
   case 'status':console.log(JSON.stringify(await client.status(options.get('--scope'))));break;
   case 'qualification':console.log(JSON.stringify(await client.qualification()));break;
   case 'configure':await client.configure();console.log(JSON.stringify({configured:true}));break;
   case 'backup':{const selection=JSON.parse(await readFile(required('selection'),'utf8'));console.log(JSON.stringify(await client.backup(selection)));break;}
   case 'export':{const path=required('output');if(!isAbsolute(path))throw new BackupBrokerError('invalid_cli_request');const file=await open(path,'wx',0o600);try{await file.writeFile(await client.exportRecoveryPackage());await file.sync();}finally{await file.close();}console.log(JSON.stringify({exported:true}));break;}
   case 'verify':{const path=required('recovery'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)||info.size>8192)throw new BackupBrokerError('invalid_recovery_copy');await client.verifyRecoveryPackage(await readFile(path,'utf8'));console.log(JSON.stringify({verified:true}));break;}
   case 'rotate':await client.rotateRecoveryKey();console.log(JSON.stringify({rotated:true}));break;
   case 'recover':await client.recoverInterruptedOperation();console.log(JSON.stringify({reconciled:true}));break;
   default:throw new BackupBrokerError('invalid_cli_request');
  }
 }
}catch(error){console.error(JSON.stringify({error:error instanceof BackupBrokerError?error.code:'broker_failed'}));process.exitCode=1;}
