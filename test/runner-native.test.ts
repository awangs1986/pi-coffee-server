import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {RunnerManager} from '../src/host/runners.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {ClaudeSession} from '../src/host/native/claude.js';
it('adds one external pointer only to configured native sessions, preserving Codex instructions across rebind/resume',async()=>{
 const root=await mkdtemp(join(tmpdir(),'runner-native-')),log=join(root,'args.json'),manager=new RunnerManager(join(root,'runners'));
 const instructions=()=>manager.instruction();
 const pi=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),env:{RUNNER_ARGS_LOG:log},instructions});
 const codex=new CodexSessionFactory({cwd:root,codexHome:join(root,'codex'),cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],instructions,env:{RUNNER_ARGS_LOG:log,FAKE_DEVELOPER_INSTRUCTIONS:'Keep native guidance.'}});
 try{
  let session=await pi.create({sessionId:randomUUID()});await session.stop();expect(JSON.parse(await readFile(log,'utf8'))).not.toContain('--append-system-prompt');
  const saved:any=await manager.handle({action:'save',runner:{name:'runner',host:'localhost',port:22,username:'test',platform:'linux',workdir:''}});
  const pointer=await instructions();session=await pi.create({sessionId:randomUUID()});await session.stop();const args=JSON.parse(await readFile(log,'utf8'));expect(args.filter((a:string)=>a===pointer)).toHaveLength(1);expect(args[args.indexOf('--append-system-prompt')+1]).toBe(pointer);
  const native=await codex.create({sessionId:'runner-test'});expect(JSON.parse(await readFile(log,'utf8')).developerInstructions).toBe('Keep native guidance.\n'+pointer);
  await native.setContextPreset!('model');expect(JSON.parse(await readFile(log,'utf8')).developerInstructions).toBe('Keep native guidance.\n'+pointer);await native.stop();
  const claude=new ClaudeSession({command:process.execPath,args:[resolve('test/fixtures/fake-claude.mjs')],env:{CLAUDE_CONFIG_DIR:join(root,'claude'),RUNNER_ARGS_LOG:log}},root,{state:'prepared',requestedId:randomUUID()},async()=>{},[],pointer);
  await claude.start();await claude.stop();expect(JSON.parse(await readFile(log,'utf8'))).toContain(pointer);
  await manager.handle({action:'delete',id:saved.runner.id});
  const resumed=await codex.create({sessionId:'runner-test'});expect(JSON.parse(await readFile(log,'utf8')).developerInstructions).toBe('Keep native guidance.');await resumed.stop();
 }finally{await codex.close();await rm(root,{recursive:true,force:true});}
});
