import {BackupRepository} from '../../dist/src/host/backup-repository.js';
import {join} from 'node:path';
const [root,id,revision,digest,stop,now]=process.argv.slice(2);
const repository=new BackupRepository({root:join(root,'repository-runtime'),coordinator:{sealedCheckpoint:async()=>undefined},now:()=>Number(now),onRetentionPhase:async event=>{if(event.phase===stop){process.send({phase:event.phase});await new Promise(()=>setInterval(()=>{},1000));}}});
try{if(stop==='restart')await repository.recoverInterruptedOperation();const result=await repository.executeRetention(id,Number(revision),digest);process.send({completed:result.state});process.disconnect();}catch(error){process.send({error:error.code||error.message});process.disconnect();process.exitCode=1;}
