/** Fixed one-request handler launched only by the credential-checked local listener. */
import {BackupKeyService,publicBrokerCode} from './host/backup-key-service.js';
let id:string|undefined;
try{
 let data='';for await(const chunk of process.stdin){data+=chunk;if(Buffer.byteLength(data)>1024*1024)throw Error('Limit');}
 const request=JSON.parse(data);id=typeof request.id==='string'?request.id:undefined;
 const service=await BackupKeyService.load(process.argv[2]);const result=await service.dispatch(request);
 const output=JSON.stringify({schema:1,id,ok:true,result});if(Buffer.byteLength(output)>1024*1024)throw Error('Limit');process.stdout.write(output+'\n');
}catch(error){process.stdout.write(JSON.stringify({schema:1,id,ok:false,error:{code:publicBrokerCode(error)}})+'\n');}
