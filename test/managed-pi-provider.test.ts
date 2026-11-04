import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {ProviderHttpBroker} from '../src/host/provider-http-broker.js';
import {ProviderCredentialGrant} from '../src/host/provider-credentials.js';

it('the pinned Pi SDK uses its actual provider overlay through the namespace broker while real synthetic credentials stay outside native execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-pi-provider-')),source=join(root,'source'),authority=join(root,'authority'),agent=join(source,'agent'),native=join(source,'native'),work=join(source,'work');for(const path of [source,authority,agent,native,work])await mkdir(path,{mode:0o700});let calls=0,authorization='';
 const upstream=createServer((req,res)=>{calls++;authorization=String(req.headers.authorization);req.resume();res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'synthetic_fixture',message:'Synthetic transport request observed; no model invoked'}}));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const port=(upstream.address() as import('node:net').AddressInfo).port;
 const models={providers:{fixture:{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',models:[{id:'fixture-model',name:'Fixture',contextWindow:8192,maxTokens:1024,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}},modelsPath=join(authority,'models.json'),authPath=join(authority,'auth.json');await writeFile(modelsPath,JSON.stringify(models),{mode:0o600});await writeFile(authPath,JSON.stringify({fixture:{type:'api_key',key:'SYNTHETIC_PRIVATE_BROKER_KEY'}}),{mode:0o600});
 const socket=join(authority,'provider.sock'),grant=new ProviderCredentialGrant({schema:1,serviceUid:process.getuid!(),sourceUid:process.getuid!()+1,socket,provider:'fixture',models:['fixture-model'],api:'openai-completions',baseUrl:`http://127.0.0.1:${port}/v1`,auth:{kind:'pi',authPath,modelsPath}}),broker=new ProviderHttpBroker({socket,peerUid:process.getuid!(),operations:grant.operations,credentials:req=>grant.credentials(req),metadata:()=>grant.publicCatalog()});await broker.listen();
 const custody=new ManagedNativeCustody(join(authority,'custody'),{sourceParent:root,lock:join(authority,'group.lock'),sources:[{path:source,destination:source}],runtimeRoots:[dirname(dirname(process.execPath)),await realpath('node_modules'),await realpath('src')],environment:{HOME:agent,PATH:'/usr/bin:/bin',PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1'},cwd:work,requireProviderTransport:true,providerTransports:{pi:{provider:'fixture',socket,serviceUid:process.getuid!(),port:23579,models:['fixture-model']}}}),factory=new RpcPiSessionFactory({cwd:work,sessionDir:native,agentDir:agent,provider:'fixture',model:'fixture-model',providerOnly:'fixture',allowedModels:['fixture/fixture-model'],nativeCustody:custody,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:'synthetic-provider-task'});expect((await session.getModels()).current).toMatchObject({provider:'fixture',id:'fixture-model'});await expect(session.setModel('openai','gpt-6.1-sol')).rejects.toThrow();expect(calls).toBe(0);await session.prompt('Synthetic local transport fixture only.');await expect.poll(()=>calls,{timeout:5000}).toBe(1);expect(authorization).toBe('Bearer SYNTHETIC_PRIVATE_BROKER_KEY');
 }finally{await session?.stop();await broker.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
