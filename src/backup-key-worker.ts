import {once} from 'node:events';
import {Socket} from 'node:net';
/** Fixed one-request handler. Trusted-root requests and peer credentials both
 * come from the accepted socket, never from caller-provided stdin metadata. */
import {hardenCurrentProcess,kernelPeerCredentials} from './host/linux-file-lease.js';
import {BackupBrokerError} from './host/backup-key-protocol.js';
import {BackupKeyService,BackupKeyStreamComplete,publicBrokerCode} from './host/backup-key-service.js';
let id:string|undefined,socket:Socket|undefined,sent=0,limit=1024*1024,operation:string|undefined,disconnected=false;
const emit=async(frame:unknown)=>{
 const output=JSON.stringify(frame)+'\n';sent+=Buffer.byteLength(output);if(Buffer.byteLength(output)>1024*1024||sent>limit)throw new BackupBrokerError('response_limit');
 if(socket){if(disconnected){if(operation==='hold-recovery-pins')throw new BackupBrokerError('recovery_pin_lease_lost');return;}if(!socket.write(output))await Promise.race([once(socket,'drain'),once(socket,'close')]);}
 else if(!process.stdout.write(output))await once(process.stdout,'drain');
};
function strictJson(data:string){
 const value=JSON.parse(data),stack:Array<Set<string>|undefined>=[],tokens=/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g;let token:RegExpExecArray|null;
 while((token=tokens.exec(data))){if(token[0]==='{')stack.push(new Set());else if(token[0]==='[')stack.push(undefined);else if(token[0]==='}'||token[0]===']')stack.pop();else if(/^\s*:/.test(data.slice(tokens.lastIndex))){const keys=stack.at(-1),key=JSON.parse(token[0]);if(!keys||keys.has(key))throw new BackupBrokerError('invalid_request');keys.add(key);}}
 return value;
}
try{
 const protectedProcess=hardenCurrentProcess();if(protectedProcess.dumpable!==0||protectedProcess.noNewPrivs!==1)throw new BackupBrokerError('service_boundary_unavailable');
 const service=await BackupKeyService.load(process.argv[2]);limit=service.responseLimit();let data='',peer:ReturnType<typeof kernelPeerCredentials>|undefined;
 if(service.requiresSocketPeer()){
  const descriptor=Number(process.env.PI_COFFEE_BACKUP_PEER_FD);if(!Number.isSafeInteger(descriptor)||descriptor<3)throw new BackupBrokerError('host_process_not_enrolled');peer=kernelPeerCredentials(descriptor);socket=new Socket({fd:descriptor,readable:true,writable:true});socket.setEncoding('utf8');socket.on('error',()=>{disconnected=true;});socket.once('close',()=>{disconnected=true;});const timer=setTimeout(()=>socket!.destroy(new BackupBrokerError('broker_timeout')),5000);
  try{for await(const chunk of socket.iterator({destroyOnReturn:false})){data+=chunk;if(Buffer.byteLength(data)>1024*1024)throw new BackupBrokerError('request_limit');const end=data.indexOf('\n');if(end>=0){if(data.slice(end+1))throw new BackupBrokerError('invalid_request');data=data.slice(0,end);break;}}}finally{clearTimeout(timer);}
 }else for await(const chunk of process.stdin){data+=chunk;if(Buffer.byteLength(data)>1024*1024)throw new BackupBrokerError('request_limit');}
 const request=strictJson(data);if(!request||typeof request!=='object'||Array.isArray(request)||peer&&Object.hasOwn(request,'_peer'))throw new BackupBrokerError('invalid_request');if(peer)request._peer=peer;
 id=typeof request.id==='string'?request.id:undefined;operation=request.operation;
 const result=await service.dispatch(request,emit);if(!(result instanceof BackupKeyStreamComplete))await emit({schema:1,id,ok:true,result});
}catch(error){await emit({schema:1,id,ok:false,error:{code:publicBrokerCode(error)}}).catch(()=>undefined);}
finally{socket?.end(()=>socket?.destroy());}
