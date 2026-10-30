import {createServer,request,Agent} from 'node:http';import {Socket} from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {connectProviderEndpoint} from './provider-http-broker.js';
// Production uses --socket only after the outside authority authenticates the
// peer and bind-mounts that exact O_PATH socket inode read-only. User namespace
// UID translation cannot authenticate the original host service UID inside.
// --fd supports environments that preserve the preauthenticated descriptor.
const args=process.argv.slice(2);let connection,port,command,pinnedSocket;
try{
 if(args[0]==='--fd'&&args[2]==='--port'&&args[4]==='--'){const fd=Number(args[1]);port=Number(args[3]);if(!Number.isSafeInteger(fd)||fd<3)throw Error();connection=new Socket({fd,readable:true,writable:true});command=args.slice(5);}
 else if(args[0]==='--socket'&&args[2]==='--port'&&args[4]==='--'){port=Number(args[3]);pinnedSocket=args[1];if(!pinnedSocket.startsWith('/'))throw Error();command=args.slice(5);}
 else if(args[3]==='--'){port=Number(args[2]);connection=await connectProviderEndpoint(args[0],Number(args[1]));command=args.slice(4);}
 else throw Error();
 if(!Number.isSafeInteger(port)||port<1024||port>65535||!command.length)throw Error();
 const agent=new Agent({keepAlive:true,maxSockets:pinnedSocket?4:1,maxFreeSockets:1});let issued=false;if(!pinnedSocket)agent.createConnection=()=>{if(issued)throw Error('Provider connection lost');issued=true;return connection;};
 const server=createServer({maxHeaderSize:16384},(req,res)=>{const upstream=request({...pinnedSocket?{socketPath:pinnedSocket}:{host:'provider'},path:req.url,method:req.method,headers:req.headers,agent},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);});
 server.on('connect',(_,socket)=>socket.destroy());server.on('upgrade',(_,socket)=>socket.destroy());server.on('clientError',(_,socket)=>socket.destroy());server.listen(port,'127.0.0.1');await once(server,'listening');
 const child=spawn(command[0],command.slice(1),{stdio:'inherit',env:{...process.env,PI_COFFEE_PROVIDER_PLACEHOLDER:'managed-provider-placeholder'}});for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>{if(child.exitCode===null)child.kill(signal);});
 child.once('error',()=>{process.exitCode=78;server.closeAllConnections();server.close();agent.destroy();connection?.destroy();});child.once('exit',code=>{process.exitCode=code??78;server.closeAllConnections();server.close();agent.destroy();connection?.destroy();});
}catch{connection?.destroy();process.stderr.write('Managed provider transport unavailable\n');process.exitCode=78;}
