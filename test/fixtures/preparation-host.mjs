import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {HostServer} from '../../dist/src/host/server.js';
import {Workspaces} from '../../dist/src/host/workspaces.js';
import {NativeAgentFactory} from '../../dist/src/host/native/factory.js';
import {CodexSessionFactory} from '../../dist/src/host/codex-adapter.js';
const root=process.argv[2];
if(process.env.PREPARATION_PUBLICATION_CRASH){
 const rename=fs.promises.rename;
 fs.promises.rename=async(from,to)=>{
  let pause=false;
  if(String(to).endsWith('/publication-op.json')){try{const record=JSON.parse(await fs.promises.readFile(from,'utf8'));pause=record.status==='finalizing';}catch{}}
  await rename(from,to);
  if(pause){console.log(JSON.stringify({publicationPaused:true}));process.kill(process.pid,'SIGSTOP');await new Promise(()=>{});}
 };
 syncBuiltinESMExports();
}

const workspaces=new Workspaces(join(root,'projects'),{taskRoot:join(root,'tasks')});
const factory=new NativeAgentFactory({workspaces,pi:{list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Unexpected Pi start');}},codex:{command:process.execPath,args:[resolve('test/fixtures/fake-codex.mjs')]},codexSessionFactory:(id,cwd,onBound,environment,preparation)=>new CodexSessionFactory({cwd,preparation,cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],codexHome:join(root,'codex'),mappingFile:join(root,'maps',id+'.json'),envForSession:environment,onBound:async(_id,native)=>onBound(native)})});
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
console.log(JSON.stringify({port:host.address().port}));
process.on('SIGTERM',()=>{void host.close().then(()=>process.exit(0));});
