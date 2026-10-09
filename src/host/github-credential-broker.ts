import {createServer,type Server} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,rename,rm,chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readJson,json} from '../shared/http.js';
/** Private per-user capability, not an additional public Host/API listener. */
export class GitHubCredentialBroker {
  private server?:Server;
  private directory?:string;
  constructor(private readonly root:string,private readonly token:(id:unknown)=>Promise<string>){}
  async start(){
    const base=join(homedir(),'.cache/pi-coffee/github-brokers');await mkdir(base,{recursive:true,mode:0o700});
    this.directory=await mkdtemp(join(base,'b-'));const socketPath=join(this.directory,'socket'),key=randomBytes(32).toString('hex');
    const server=this.server=createServer((req,res)=>{void (async()=>{
      try {
        const bearer=req.headers.authorization?.replace(/^Bearer /,'');
        if(req.method!=='POST'||req.url!=='/token'||!bearer||bearer.length!==key.length||!timingSafeEqual(Buffer.from(bearer),Buffer.from(key))){json(res,401,{error:'Unauthorized'});return;}
        const input=await readJson(req,1024);json(res,200,{token:await this.token(input.id)});
      }catch{json(res,409,{error:'GitHub authorization unavailable; reconnect if revoked'});}
    })();});
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);server.unref();
    const file=join(this.root,'broker.json'),temp=file+'.'+key;await writeFile(temp,JSON.stringify({socketPath,key}),{mode:0o600});await rename(temp,file);
  }
  async close(){if(this.server)await new Promise<void>(resolve=>this.server!.close(()=>resolve()));if(this.directory)await rm(this.directory,{recursive:true,force:true});}
}
