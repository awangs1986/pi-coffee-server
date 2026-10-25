// Trusted synthetic transport fixture. It exercises the real repository pin
// authority, not production distinct-UID/source qualification.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {BackupRepository} from '../../dist/src/host/backup-repository.js';
let request;try{
 const config=JSON.parse(await readFile(process.argv[2],'utf8'));let input='';for await(const chunk of process.stdin)input+=chunk;request=JSON.parse(input);
 if(request.schema!==1||request._peer.uid!==process.getuid()||request.context.actor!=='awangs'||request.context.dataScope!=='alice'||request.context.authorityRevision!==7||request.operation!=='hold-recovery-pins')throw Object.assign(Error('Denied'),{code:'scope_denied'});
 const repository=new BackupRepository({root:join(config.privateRoot,'repository-runtime'),coordinator:{sealedCheckpoint:async()=>undefined},now:()=>config.fixtureClock});
 const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
 await repository.withRecoveryPins(request.pinIds,async lease=>{emit({schema:1,id:request.id,ok:true,result:{lease:true,pinIds:request.pinIds}});for(let n=0;n<1800;n++){await new Promise(resolve=>setTimeout(resolve,1000));lease.assertHeld();emit({schema:1,id:request.id,kind:'pin-heartbeat'});}});
}catch(error){process.stdout.write(JSON.stringify({schema:1,id:request?.id,ok:false,error:{code:error.code||'fixture_failed'}})+'\n');}
