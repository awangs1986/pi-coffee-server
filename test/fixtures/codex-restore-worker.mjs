/** Isolated synthetic job worker. Never used in production composition. */
import {join} from 'node:path';
import {readFile,open} from 'node:fs/promises';
import {Workspaces} from '../../dist/src/host/workspaces.js';
import {RestoreCoordinator} from '../../dist/src/host/restore.js';
import {BackupRepository} from '../../dist/src/host/backup-repository.js';
import {BackupCoordinator,WriterAdmissionFence} from '../../dist/src/host/backup.js';
import {CodexNativeRecoveryAdapter} from '../../dist/src/host/codex-recovery.js';
const [root,id,digest,stopAt]=process.argv.slice(2),workspaces=new Workspaces(join(root,'alice','projects'));await workspaces.list();
const pause=async phase=>{if(phase===stopAt){process.send?.({phase,operationId:id});await new Promise(done=>process.once('message',done));}};
// The index fault writes and fsyncs half the approved suffix under the job lease
// before SIGKILL. This is deliberate persisted-state injection, not a mock of
// the production append implementation or a claim about syscall split timing.
const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})}),adapter=new CodexNativeRecoveryAdapter({scope:'alice',workspaces,codexHome:join(root,'native'),sqliteHome:join(root,'sqlite'),cliVersion:'0.159.1',fence,sourceCustody:async()=>({known:true}),onDatabaseCommit:async()=>{if(stopAt==='index'){const approved=JSON.parse(await readFile(join(root,'restores',id+'.json'),'utf8')),append=approved.plan.nativeMerge.appends.find(item=>item.path.endsWith('/session_index.jsonl'));if(!append)throw Error('Fixture expected approved append');const suffix=Buffer.from(append.suffix),file=await open(append.path,'a');try{await file.writeFile(suffix.subarray(0,Math.max(1,Math.floor(suffix.length/2))));await file.sync();}finally{await file.close();}await pause('index');}await pause('database');}});
const repository=new BackupRepository({root:join(root,'repository'),coordinator:new BackupCoordinator({root:join(root,'checkpoints')})});
const restore=new RestoreCoordinator({root:join(root,'restores'),repository,scope:async()=>({workspaces,adapter}),authorize:async(actor,scope,manage)=>scope==='alice'&&(manage?actor==='awangs':actor==='alice'),onPublication:async event=>pause(event.phase)});
try{const result=await restore.operate('awangs',id,{action:'publish',revision:1,digest});process.send?.({result});process.disconnect?.();}catch(error){process.send?.({error:error.code??'failure'});process.disconnect?.();process.exitCode=1;}
