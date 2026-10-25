/** Isolated synthetic job worker. Never used in production composition. */
import {join} from 'node:path';
import {Workspaces} from '../../dist/src/host/workspaces.js';
import {RestoreCoordinator} from '../../dist/src/host/restore.js';
import {WriterAdmissionFence} from '../../dist/src/host/backup.js';
import {CodexNativeRecoveryAdapter} from '../../dist/src/host/codex-recovery.js';
const [root,id,digest,stopAt]=process.argv.slice(2),workspaces=new Workspaces(join(root,'alice','projects'));await workspaces.list();
const pause=async phase=>{if(phase===stopAt){process.send?.({phase,operationId:id});await new Promise(done=>process.once('message',done));}};
const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})}),adapter=new CodexNativeRecoveryAdapter({scope:'alice',workspaces,codexHome:join(root,'native'),sqliteHome:join(root,'sqlite'),cliVersion:'0.159.1',fence,sourceCustody:async()=>({known:true}),onDatabaseCommit:async()=>pause('database')});
const restore=new RestoreCoordinator({root:join(root,'restores'),scope:async()=>({workspaces,adapter}),authorize:async(actor,scope,manage)=>scope==='alice'&&(manage?actor==='awangs':actor==='alice'),onPublication:async event=>pause(event.phase)});
try{const result=await restore.operate('awangs',id,{action:'publish',revision:1,digest});process.send?.({result});process.disconnect?.();}catch(error){process.send?.({error:error.code??'failure'});process.disconnect?.();process.exitCode=1;}
