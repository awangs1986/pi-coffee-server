import {once} from 'node:events';
/** Fixed one-request handler launched only by the credential-checked local listener. */
import {hardenCurrentProcess} from './host/linux-file-lease.js';
import {BackupKeyService,BackupKeyStreamComplete,publicBrokerCode} from './host/backup-key-service.js';
let id:string|undefined;
try{
 const protectedProcess=hardenCurrentProcess();if(protectedProcess.dumpable!==0||protectedProcess.noNewPrivs!==1)throw Error('Boundary');
 let data='';for await(const chunk of process.stdin){data+=chunk;if(Buffer.byteLength(data)>1024*1024)throw Error('Limit');}
 const request=JSON.parse(data);id=typeof request.id==='string'?request.id:undefined;
 const service=await BackupKeyService.load(process.argv[2]);const result=await service.dispatch(request,async frame=>{const output=JSON.stringify(frame);if(Buffer.byteLength(output)>1024*1024)throw Error('Limit');if(!process.stdout.write(output+'\n'))await once(process.stdout,'drain');});
 if(!(result instanceof BackupKeyStreamComplete)){const output=JSON.stringify({schema:1,id,ok:true,result});if(Buffer.byteLength(output)>1024*1024)throw Error('Limit');process.stdout.write(output+'\n');}
}catch(error){process.stdout.write(JSON.stringify({schema:1,id,ok:false,error:{code:publicBrokerCode(error)}})+'\n');}
