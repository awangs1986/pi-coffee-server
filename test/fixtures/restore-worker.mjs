/** Controlled synthetic source set. This worker is never production wiring. */
import {join} from 'node:path';
import {Workspaces} from '../../dist/src/host/workspaces.js';
import {RestoreCoordinator} from '../../dist/src/host/restore.js';
import {WriterAdmissionFence} from '../../dist/src/host/backup.js';
import {PiNativeRecoveryAdapter} from '../../dist/src/host/pi-recovery.js';
const [root,id,digest,stopAt]=process.argv.slice(2);
const workspaces=new Workspaces(join(root,'alice','projects'));await workspaces.list();
const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})});
const adapter=new PiNativeRecoveryAdapter({scope:'alice',workspaces,sessionDir:join(root,'native'),agentDir:join(root,'agent'),fence,sourceCustody:async()=>({known:true})});
const coordinator=new RestoreCoordinator({root:join(root,'restore-runtime'),scope:async()=>({workspaces,adapter}),authorize:async(actor,scope,manage)=>manage&&actor==='awangs'&&scope==='alice',onPublication:async event=>{if(event.phase===stopAt){process.send?.(event);await new Promise(resolve=>process.once('message',resolve));}}});
try{const result=await coordinator.operate('awangs',id,{action:'publish',revision:1,digest});process.send?.({result});process.disconnect?.();}catch(error){process.send?.({error:error.code??'failure'});process.disconnect?.();process.exitCode=1;}
