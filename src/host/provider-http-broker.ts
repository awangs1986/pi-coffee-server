import {createServer,request as httpRequest,validateHeaderName,validateHeaderValue,type IncomingMessage,type ServerResponse,type Server} from 'node:http';
import {request as httpsRequest} from 'node:https';import {createConnection,type Socket} from 'node:net';import {lstat,realpath,chmod,rm} from 'node:fs/promises';import {dirname,resolve,isAbsolute} from 'node:path';import {once} from 'node:events';
import {kernelPeerCredentials} from './linux-file-lease.js';
export interface ProviderOperation {method:'POST'|'GET';path:string;upstream:string;}
export interface ProviderHttpBrokerOptions {
 socket:string;peerUid:number;operations:readonly ProviderOperation[];
 /** Re-read current actor/provider authority and refresh credentials outside the
  * model namespace for each request. Throw on revocation or expired authority. */
 credentials:()=>Promise<Record<string,string>>;
 maxRequestBytes?:number;maxResponseBytes?:number;maxConcurrent?:number;timeoutMs?:number;socketMode?:0o600|0o660;
}
const peerFd=(socket:Socket)=>(socket as Socket&{_handle?:{fd?:number}})._handle?.fd;
function checkedPeer(socket:Socket,uid:number){const fd=peerFd(socket);if(fd===undefined||kernelPeerCredentials(fd).uid!==uid)throw Error('Provider peer refused');}
function validUid(uid:number){return Number.isSafeInteger(uid)&&uid>=0;}
const passRequest=['content-type','accept','anthropic-version','anthropic-beta','openai-beta'];
const passResponse=['content-type','cache-control','retry-after','x-request-id','request-id'];
/** One endpoint is one trusted grant. No request supplies an upstream URL,
 * credential, executable, account or path on the host filesystem. */
export class ProviderHttpBroker {
 private server?:Server;private identity?:{dev:number;ino:number};private sockets=new Set<Socket>();private active=0;private routes=new Map<string,URL>();
 constructor(private options:ProviderHttpBrokerOptions){
  if(!isAbsolute(options.socket)||!validUid(options.peerUid)||!options.operations.length||options.operations.length>32||options.maxRequestBytes!==undefined&&(!Number.isSafeInteger(options.maxRequestBytes)||options.maxRequestBytes<1||options.maxRequestBytes>64*1024**2)||options.maxResponseBytes!==undefined&&(!Number.isSafeInteger(options.maxResponseBytes)||options.maxResponseBytes<1||options.maxResponseBytes>1024**3)||options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>60*60*1000)||options.socketMode!==undefined&&![0o600,0o660].includes(options.socketMode)||options.maxConcurrent!==undefined&&(!Number.isSafeInteger(options.maxConcurrent)||options.maxConcurrent<1||options.maxConcurrent>16))throw Error('Invalid provider grant');
  for(const operation of options.operations){if(!['POST','GET'].includes(operation.method)||!/^\/[A-Za-z0-9/_-]+$/.test(operation.path)||operation.path.includes('//')||this.routes.has(operation.method+' '+operation.path))throw Error('Invalid provider operation');const url=new URL(operation.upstream);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('Invalid provider upstream');this.routes.set(operation.method+' '+operation.path,url);}
 }
 async listen(){
  if(this.server)throw Error('Provider endpoint already started');const parent=dirname(resolve(this.options.socket)),directory=await lstat(parent);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid?.()||(directory.mode&0o027)||await realpath(parent)!==parent)throw Error('Unsafe provider endpoint directory');
  try{await lstat(this.options.socket);throw Error('Provider endpoint already exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const accepted=new WeakSet<Socket>(),server=createServer({maxHeaderSize:16384},(req,res)=>{if(!accepted.has(req.socket)){req.socket.destroy();return;}void this.handle(req,res);});this.server=server;
  server.requestTimeout=this.options.timeoutMs??30*60*1000;server.headersTimeout=10000;server.keepAliveTimeout=30*60*1000;server.maxRequestsPerSocket=0;
  server.on('connection',socket=>{try{checkedPeer(socket,this.options.peerUid);if(this.sockets.size>=32)throw Error('Provider socket capacity');accepted.add(socket);this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));}catch{socket.destroy();}});
  server.on('connect',(_,socket)=>socket.destroy());server.on('upgrade',(_,socket)=>socket.destroy());server.on('clientError',(_,socket)=>socket.destroy());
  server.listen(this.options.socket);try{await once(server,'listening');await chmod(this.options.socket,this.options.socketMode??0o600);const stat=await lstat(this.options.socket);this.identity={dev:stat.dev,ino:stat.ino};}catch(error){this.server=undefined;server.close();throw error;}
 }
 private async handle(req:IncomingMessage,res:ServerResponse){
  const fail=(status:number)=>{if(res.headersSent)res.destroy();else{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"provider_transport_refused"}\n');}};
  const endpoint=this.routes.get((req.method??'')+' '+(req.url??''));if(!endpoint){req.resume();fail(403);return;}if(this.active>=(this.options.maxConcurrent??4)){req.resume();fail(429);return;}
  this.active++;let upstream:ReturnType<typeof httpRequest>|undefined;let timer:NodeJS.Timeout|undefined;
  try{
   const chunks:Buffer[]=[];let length=0;for await(const chunk of req.iterator({destroyOnReturn:false})){length+=chunk.length;if(length>(this.options.maxRequestBytes??32*1024**2)){req.resume();fail(413);return;}chunks.push(Buffer.from(chunk));}
   const body=Buffer.concat(chunks);if(req.method==='POST'){try{const value=JSON.parse(body.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch{fail(400);return;}}
   let credentials:Record<string,string>;try{credentials=await this.options.credentials();}catch{fail(403);return;}
   const headers:Record<string,string>={};for(const name of passRequest){const value=req.headers[name];if(typeof value==='string')headers[name]=value;}
   for(const [name,value] of Object.entries(credentials)){validateHeaderName(name);validateHeaderValue(name,value);if(['host','connection','content-length','transfer-encoding','upgrade','proxy-authorization'].includes(name.toLowerCase()))throw Error('Unsafe provider credential header');headers[name]=value;}
   headers['content-length']=String(body.length);headers['accept-encoding']='identity';
   await new Promise<void>((complete,reject)=>{
    let settled=false;const done=(error?:Error)=>{if(settled)return;settled=true;res.off('close',disconnected);error?reject(error):complete();};const disconnected=()=>{upstream?.destroy();done();};res.once('close',disconnected);
    upstream=(endpoint.protocol==='https:'?httpsRequest:httpRequest)(endpoint,{method:req.method,headers,agent:false},response=>{
     if(response.statusCode===undefined||response.statusCode>=300&&response.statusCode<400){response.destroy();fail(502);done();return;}
     const publicHeaders:Record<string,string>={'cache-control':'no-store'};for(const name of passResponse){const value=response.headers[name];if(typeof value==='string'&&name!=='cache-control')publicHeaders[name]=value;}res.writeHead(response.statusCode,publicHeaders);let bytes=0;
     response.on('data',chunk=>{bytes+=chunk.length;if(bytes>(this.options.maxResponseBytes??256*1024**2)){response.destroy();upstream?.destroy();fail(502);done();return;}if(!res.write(chunk))response.pause();});res.on('drain',()=>response.resume());response.once('error',()=>done(Error('Provider response failed')));response.once('end',()=>{res.end();done();});response.once('aborted',()=>done(Error('Provider response incomplete')));
    });timer=setTimeout(()=>{upstream?.destroy();done(Error('Provider request timed out'));},this.options.timeoutMs??30*60*1000);upstream.once('error',()=>done(Error('Provider request failed')));upstream.end(body);
   });
  }catch{fail(502);}finally{clearTimeout(timer);this.active--;}
 }
 async close(){const server=this.server;if(!server)return;this.server=undefined;for(const socket of this.sockets)socket.destroy();await new Promise<void>(ok=>server.close(()=>ok()));try{const current=await lstat(this.options.socket);if(this.identity&&current.dev===this.identity.dev&&current.ino===this.identity.ino)await rm(this.options.socket);}catch{/* Never replace or remove another endpoint. */}}
}
/** Call in the source authority before entering user namespaces. The returned
 * connected descriptor may be inherited only as a provider capability. */
export async function connectProviderEndpoint(socketPath:string,serviceUid:number):Promise<Socket>{
 if(!isAbsolute(socketPath)||!validUid(serviceUid))throw Error('Invalid provider endpoint');const before=await lstat(socketPath);if(!before.isSocket()||before.uid!==serviceUid)throw Error('Provider endpoint refused');const socket=createConnection(socketPath);try{await once(socket,'connect');checkedPeer(socket,serviceUid);const after=await lstat(socketPath);if(after.dev!==before.dev||after.ino!==before.ino||!after.isSocket()||after.uid!==serviceUid)throw Error('Provider endpoint changed');return socket;}catch{socket.destroy();throw Error('Provider endpoint refused');}
}
