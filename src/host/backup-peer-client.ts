import {createConnection} from 'node:net';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,dirname,resolve} from 'node:path';
import {once} from 'node:events';
import {kernelPeerCredentials} from './linux-file-lease.js';
import {BackupBrokerError} from './backup-key-protocol.js';

/** Connect in the real Host process: SO_PEERCRED must identify the enrolled
 * caller, never a helper child or a PID supplied in the request body. */
export async function* backupPeerFrames(options:{socket:string;serviceUid:number;request:unknown;maxBytes?:number;timeoutMs?:number;signal?:AbortSignal}):AsyncGenerator<any>{
 const maximum=options.maxBytes??1024*1024,timeout=options.timeoutMs??30*60*1000;
 if(!isAbsolute(options.socket)||!Number.isSafeInteger(options.serviceUid)||options.serviceUid<0||!Number.isSafeInteger(maximum)||maximum<1||maximum>2*1024**3)throw new BackupBrokerError('peer_identity_mismatch');
 const encoded=JSON.stringify(options.request)+'\n';if(Buffer.byteLength(encoded)>1024*1024)throw new BackupBrokerError('request_limit');
 let before;try{before=await lstat(options.socket);if(!before.isSocket()||before.uid!==options.serviceUid||(before.mode&0o007)||await realpath(dirname(options.socket))!==resolve(dirname(options.socket)))throw Error();}catch{throw new BackupBrokerError('peer_identity_mismatch');}
 options.signal?.throwIfAborted();const socket=createConnection(options.socket);socket.on('error',()=>undefined);
 const timer=setTimeout(()=>socket.destroy(new BackupBrokerError('broker_timeout')),timeout),abort=()=>socket.destroy(new BackupBrokerError('job_cancelled'));options.signal?.addEventListener('abort',abort,{once:true});
 try{
  await once(socket,'connect');const descriptor=(socket as typeof socket&{_handle?:{fd?:number}})._handle?.fd;
  if(descriptor===undefined||kernelPeerCredentials(descriptor).uid!==options.serviceUid)throw new BackupBrokerError('peer_identity_mismatch');
  const after=await lstat(options.socket);if(after.dev!==before.dev||after.ino!==before.ino)throw new BackupBrokerError('peer_identity_mismatch');
  if(options.signal?.aborted)throw new BackupBrokerError('job_cancelled');socket.write(encoded);socket.setEncoding('utf8');let bytes=0,buffer='';
  for await(const chunk of socket){bytes+=Buffer.byteLength(chunk);buffer+=chunk;if(bytes>maximum)throw new BackupBrokerError('response_limit');
   for(;;){const end=buffer.indexOf('\n');if(end<0)break;if(Buffer.byteLength(buffer.slice(0,end))>1024*1024)throw new BackupBrokerError('response_limit');const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{yield JSON.parse(line);}catch(error){if(error instanceof BackupBrokerError)throw error;throw new BackupBrokerError('invalid_response');}}
   if(Buffer.byteLength(buffer)>1024*1024)throw new BackupBrokerError('response_limit');
  }
  if(buffer)throw new BackupBrokerError('invalid_response');
 }catch(error){if(error instanceof BackupBrokerError)throw error;throw new BackupBrokerError('transport_unavailable');}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);socket.destroy();}
}
