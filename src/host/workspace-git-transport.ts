import {createServer,request as httpRequest,type Server} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {once} from 'node:events';
import type {Socket} from 'node:net';
import {kernelPeerCredentials} from './linux-file-lease.js';

export interface WorkspaceGitTransport {
 repository:string;
 credentials:()=>Promise<Record<string,string>>;
}
/** A command owns one socket and one repository. Git config never selects the
 * upstream, sees a credential, follows a redirect, or obtains a general proxy. */
export async function workspaceGitTransport(lock:string,transport:WorkspaceGitTransport,write:boolean){
 const target=new URL(transport.repository);
 if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash)throw Error('Unsupported managed Git repository');
 const directory=await mkdtemp(join(dirname(lock),'git-')),socket=join(directory,'transport.sock');await chmod(directory,0o700);
 const service=write?'git-receive-pack':'git-upload-pack',base=target.href.replace(/\/$/,''),routes=new Map([
  ['GET /repository/info/refs?service='+service,base+'/info/refs?service='+service],['POST /repository/'+service,base+'/'+service],
 ]),connections=new Set<Socket>();let active=0;
 const server:Server=createServer({maxHeaderSize:8192},(req,res)=>{void (async()=>{
  const fail=(status:number)=>{if(res.headersSent)res.destroy();else{res.writeHead(status,{'content-type':'text/plain'});res.end('Managed Git transport refused\n');}};
  const upstreamUrl=routes.get(req.method+' '+req.url);if(!upstreamUrl||active>=2){req.resume();fail(403);return;}
  active++;let upstream:ReturnType<typeof httpRequest>|undefined;
  try{
   const credentials=await transport.credentials(),headers:Record<string,string>={...credentials,'accept-encoding':'identity'};
   if(req.method==='POST'){if(req.headers['content-type']!=='application/x-'+service+'-request'){req.resume();fail(403);return;}headers['content-type']=String(req.headers['content-type']);if(req.headers['content-encoding']==='gzip')headers['content-encoding']='gzip';else if(req.headers['content-encoding']){req.resume();fail(403);return;}}
   if(typeof req.headers['git-protocol']==='string')headers['git-protocol']=req.headers['git-protocol'];
   upstream=(target.protocol==='https:'?httpsRequest:httpRequest)(upstreamUrl,{method:req.method,headers,agent:false,timeout:120000},response=>{
    if(response.statusCode!==200){response.resume();fail(response.statusCode===401||response.statusCode===403?403:502);return;}
    res.writeHead(200,{'content-type':String(response.headers['content-type']??'application/octet-stream'),'cache-control':'no-store'});
    let received=0;response.on('data',chunk=>{received+=chunk.length;if(received>1024**3){upstream?.destroy();fail(502);}});response.on('error',()=>fail(502));response.pipe(res);
   });upstream.on('timeout',()=>upstream?.destroy());upstream.on('error',()=>fail(502));req.on('aborted',()=>upstream?.destroy());res.once('close',()=>upstream?.destroy());
   let sent=0;req.on('data',chunk=>{sent+=chunk.length;if(sent>1024**3){upstream?.destroy();fail(413);}});req.pipe(upstream);
   await new Promise<void>(resolve=>{res.once('close',resolve);res.once('finish',resolve);});
  }catch{fail(403);}finally{active--;}
 })();});
 server.on('connection',connection=>{try{const fd=(connection as Socket&{_handle?:{fd?:number}})._handle?.fd;if(fd===undefined||kernelPeerCredentials(fd).uid!==process.getuid?.()||connections.size>=4)throw Error();connections.add(connection);connection.once('close',()=>connections.delete(connection));}catch{connection.destroy();}});
 server.on('connect',(_,connection)=>connection.destroy());server.on('upgrade',(_,connection)=>connection.destroy());server.on('clientError',(_,connection)=>connection.destroy());server.requestTimeout=120000;server.headersTimeout=10000;
 const close=async()=>{for(const connection of connections)connection.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});};
 try{server.listen(socket);await once(server,'listening');await chmod(socket,0o600);}catch(error){await close();throw error;}
 return {socket,port:18673,serviceUid:process.getuid!(),repository:transport.repository,close};
}
