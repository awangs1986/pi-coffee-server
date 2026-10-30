// Test-only process restart of an already reviewed operation journal. This does
// not qualify an OS export, call cold plan(), or expose a production CLI option.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {BackupCoordinator,WriterAdmissionFence} from '../../dist/src/host/backup.js';
import {BackupRepository} from '../../dist/src/host/backup-repository.js';
import {PiNativeRecoveryAdapter} from '../../dist/src/host/pi-recovery.js';
import {RestoreCoordinator} from '../../dist/src/host/restore.js';
import {AccountRecoveryCoordinator} from '../../dist/src/host/account-recovery.js';
import {ColdEnrollmentCoordinator} from '../../dist/src/host/cold-enrollment.js';
import {Workspaces} from '../../dist/src/host/workspaces.js';
const configured=JSON.parse(await readFile(process.argv[2],'utf8')),root=configured.root;
const fence=new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true})});
const authorize=async(actor,scope,manage)=>['alice','bob'].includes(scope)&&(manage?configured.actors.includes(actor):actor===scope||configured.actors.includes(actor));
const stores=new Map(),adapters=new Map();
for(const scope of ['alice','bob']){const workspaces=new Workspaces(join(root,scope,'projects'));stores.set(scope,workspaces);adapters.set(scope,new PiNativeRecoveryAdapter({scope,workspaces,sessionDir:join(root,scope,'native'),agentDir:join(root,scope,'agent'),fence,sourceCustody:async()=>({known:true})}));}
const scope=async id=>({workspaces:stores.get(id),adapter:adapters.get(id)}),repository=new BackupRepository({root:join(root,'repository'),coordinator:new BackupCoordinator({root:join(root,'checkpoints')})}),restore=new RestoreCoordinator({root:join(root,'restores'),repository,authorize,scope}),accounts=new AccountRecoveryCoordinator({root:join(root,'accounts'),restore,scope,authorize,materialSource:async()=>repository,pins:async()=>repository});
const cold=new ColdEnrollmentCoordinator({root:join(root,'cold-operations'),accounts,authorize:async actor=>configured.actors.includes(actor),archive:async()=>{throw Error('No export qualification in this fixture');}});
console.log(JSON.stringify(await cold.operate('awangs',configured.operationId,{action:'publish',revision:configured.revision,digest:configured.digest})));
