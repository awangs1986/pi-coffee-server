/** Independent worker: no Web/browser/model dependency; authenticated Host inventory is optional. */
import {readFile,open,lstat} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {BackupCoordinator,BackupError} from './host/backup.js';
import {BackupRepository} from './host/backup-repository.js';
import {BackupRepositoryClient} from './host/backup-repository-client.js';
import {verifyStateArchive} from './host/state-archive.js';
import {GiteaBackupJob} from './host/gitea-backup.js';
import {BackupJobRunner} from './host/backup-job-runner.js';

const args=process.argv.slice(2),command=args.shift(),options=new Map<string,string>();
try{
 if(args.length%2)throw Error('Use --name value pairs');
 for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||options.has(args[i]))throw Error('Invalid option');options.set(args[i],args[i+1]);}
 const required=(key:string)=>{const value=options.get('--'+key);if(!value)throw Error('Missing --'+key);return value;};
 if(command==='verify-offline'){const info=await lstat(required('recovery'));if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.size>8192)throw Error('Recovery copy must be private');console.log(JSON.stringify(await BackupRepository.verifyOfflineRecoveryPackage(await readFile(required('recovery'),'utf8'),{destination:required('destination'),binary:required('binary')})));process.exit(0);}
 const root=required('root');if(!isAbsolute(root))throw Error('--root must be absolute');
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints')});
 const broker=options.has('--broker-profile')?await BackupRepositoryClient.fromConfig(required('broker-profile')):undefined;
 const repository=broker??new BackupRepository({root:join(root,'repository-runtime'),coordinator});
 const runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator});
 const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
 switch(command){
  case 'offline-open':{
   if(!(repository instanceof BackupRepository))throw Error('Personal repository required');
   const file=required('recovery'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.size>8192)throw Error('Recovery copy must be private');
   console.log(JSON.stringify(await repository.openOfflineRecovery(await readFile(file,'utf8'),{destination:required('destination'),binary:required('binary')})));break;
  }
  case 'offline-list':case 'offline-import':case 'offline-extract':case 'offline-gitea-profile':{
   if(!(repository instanceof BackupRepository))throw Error('Personal repository required');
   if(command==='offline-list'){console.log(JSON.stringify(await repository.offlineSnapshots()));break;}
   if(command==='offline-import'){console.log(JSON.stringify(await repository.importOfflineSnapshot(required('snapshot'))));break;}
   await repository.extract(required('job'),required('output'));
   if(command==='offline-gitea-profile'){
    const archive=await verifyStateArchive(join(required('output'),'archive'));if(archive.kind!=='gitea'||!archive.recovery?.giteaProfile)throw Error('Recovery profile missing; reconstruct from archive roots and the runbook');
    const file=await open(required('profile'),'wx',0o600);try{await file.writeFile(JSON.stringify(archive.recovery.giteaProfile));await file.sync();}finally{await file.close();}
   }
   console.log(JSON.stringify({extracted:true,...(command==='offline-gitea-profile'?{profileExported:true}:{})}));break;
  }

  case 'gitea-backup':case 'gitea-status':case 'gitea-preview':case 'gitea-confirm':{
   if(!(repository instanceof BackupRepository))throw Error('Personal repository required');
   const service=new GiteaBackupJob({root:join(root,'gitea'),repository,profile:required('profile')});
   const result=command==='gitea-backup'?await service.backup():command==='gitea-status'?await service.status():command==='gitea-preview'?await service.preview(required('job'),{mode:options.get('--mode') as 'missing-only'|'replace'|undefined,...(options.has('--recovery')?{recoveryPackage:await readFile(required('recovery'),'utf8')}:{})}):await service.confirm(required('id'),required('digest'));
   console.log(JSON.stringify(result));break;
  }

  case 'retention-preview':{const scopes=JSON.parse(required('scopes'));if(!Array.isArray(scopes)||scopes.some(scope=>typeof scope!=='string'))throw Error('Invalid retention scopes');console.log(JSON.stringify(await repository.previewRetention({scopes,timeZone:options.get('--time-zone')})));break;}
  case 'retention-status':console.log(JSON.stringify({plans:await repository.retentionPlans(required('scope')),pins:await repository.recoveryPins(required('scope'))}));break;
  case 'retention-execute':{const revision=Number(required('revision'));if(!Number.isSafeInteger(revision))throw Error('Invalid plan revision');console.log(JSON.stringify(await repository.executeRetention(required('plan'),revision,required('digest'))));break;}
  case 'schedule-configure':{
   const file=required('policy'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.size>32768)throw Error('Schedule policy must be private');
   await runner.configure(JSON.parse(await readFile(file,'utf8')));console.log(JSON.stringify({configured:true}));break;
  }
  case 'schedule-tick':console.log(JSON.stringify(await runner.tick()));break;
  case 'schedule-status':console.log(JSON.stringify(await runner.status(required('scope'))));break;
  case 'schedule-daemon':{
   while(!controller.signal.aborted){try{await runner.tick();}catch(error){console.error(JSON.stringify({error:error instanceof BackupError?error.code:'schedule_failed'}));}
    if(!controller.signal.aborted)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,30000);controller.signal.addEventListener('abort',done,{once:true});});
   }break;
  }
  case 'configure':if(broker)await broker.configure();else await repository.configure({destination:required('destination'),binary:required('binary')});console.log(JSON.stringify({configured:true}));break;
  case 'export':{
   const output=required('output');if(!isAbsolute(output))throw Error('--output must be absolute');
   const file=await open(output,'wx',0o600);try{await file.writeFile(await repository.exportRecoveryPackage());await file.sync();}finally{await file.close();}console.log(JSON.stringify({exported:true}));break;
  }
  case 'verify':{const file=required('recovery');const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.size>8192)throw Error('Recovery copy must be a private regular file');await repository.verifyRecoveryPackage(await readFile(file,'utf8'));console.log(JSON.stringify({enabled:true}));break;}
  case 'run':{
   const selection=options.has('--selection')?JSON.parse(await readFile(required('selection'),'utf8')):[{scope:required('scope'),taskId:required('task'),...options.has('--checkpoint-id')?{expectedCheckpointId:required('checkpoint-id')}:{} }];
   if(!Array.isArray(selection)||selection.some(item=>typeof item?.scope!=='string'||typeof item?.taskId!=='string'||item.expectedCheckpointId!==undefined&&(typeof item.expectedCheckpointId!=='string'||!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(item.expectedCheckpointId))||broker&&!item.expectedCheckpointId))throw Error('Invalid selection');
   console.log(JSON.stringify(await repository.backup(selection,controller.signal)));break;
  }
  case 'rotate':await repository.rotateRecoveryKey();console.log(JSON.stringify({rotationPending:true}));break;
  case 'recover':await repository.recoverInterruptedOperation();console.log(JSON.stringify({reconciled:true}));break;
  case 'status':console.log(JSON.stringify(await repository.status(required('scope'))));break;
  default:throw Error('Use offline-{open,list,import,extract,gitea-profile}, gitea-{backup,status,preview,confirm}, configure, export, verify, run, recover, status, schedule-{configure,tick,status,daemon} or retention-{preview,status,execute}');
 }
}catch(error){console.error(JSON.stringify({error:error instanceof BackupError?error.code:error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[a-z_]{1,64}$/.test(error.code)?error.code:'invalid_cli_request'}));process.exitCode=1;}
