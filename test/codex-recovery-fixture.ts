import {it,expect} from 'vitest';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {GroupedRecoveryAdapter} from '../src/host/grouped-recovery.js';
import {PiNativeRecoveryAdapter} from '../src/host/pi-recovery.js';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {once} from 'node:events';
import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {CodexNativeRecoveryAdapter} from '../src/host/codex-recovery.js';
import {RestoreCoordinator} from '../src/host/restore.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {readCodexHistory} from '../src/host/codex/history.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';

export async function codexFixture(options?:{project?:boolean;initialEngine?:'pi'|'codex';personalConfiguration?:boolean}){
 const root=await mkdtemp(join(tmpdir(),'coffee-codex-recovery-')),home=join(root,'native'),sql=join(root,'sqlite');await mkdir(home,{mode:0o700});await mkdir(sql,{mode:0o700});
 const store=new Workspaces(join(root,'alice','projects'));const engine=options?.initialEngine??'codex';let task:import('../src/host/workspaces.js').Conversation;
 if(options?.project){const source=join(root,'fixture-git');await mkdir(source,{mode:0o700});const git=(...args:string[])=>execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@localhost',...args],{cwd:source,stdio:'ignore'});git('init','-b','main');await writeFile(join(source,'base.txt'),'committed base');git('add','.');git('commit','-m','synthetic base');const project=await store.registerProject('Synthetic',source);task=await store.createConversation(project.id,undefined,'codex-task',engine);execFileSync('git',['repack','-a','-d'],{cwd:task.cwd,stdio:'ignore'});}
 else{await store.createChatConversation('codex-task',engine);task=(await store.lookup('codex-task'))!;}
 const id=randomUUID();if(engine==='codex')await store.setNativeBinding(task.id,{state:'bound',id});const current=(await store.lookup(task.id))!;
 const turn=randomUUID(),rollout=join(home,'sessions','2026','10','25','rollout-2026-10-25T12-00-00-'+id+'.jsonl');await mkdir(join(home,'sessions','2026','10','25'),{recursive:true,mode:0o700});
 const rows=[['session_meta',{id,session_id:id,cwd:task.cwd,cli_version:'0.159.1',history_mode:'paginated',timestamp:'2026-10-25T12:00:00Z',source:'cli',model_provider:'fixture',originator:'backup_synthetic_fixture',base_instructions:{text:'Synthetic fixture only.'}}],['event_msg',{type:'task_started',turn_id:turn,model_context_window:500000}],['event_msg',{type:'user_message',message:'The ordinary question',images:[],local_images:[],text_elements:[]}],['event_msg',{type:'item_completed',thread_id:id,turn_id:turn,item:{type:'UserMessage',id:'original-user-item',content:[{type:'text',text:'The ordinary question',text_elements:[]}]},completed_at_ms:1792929600000}],['response_item',{type:'message',role:'user',content:[{type:'input_text',text:'The ordinary question'}]}],['response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'The ordinary answer'}]}],['event_msg',{type:'agent_message',message:'The ordinary answer',phase:'final_answer'}],['event_msg',{type:'item_completed',thread_id:id,turn_id:turn,item:{type:'AgentMessage',id:'original-agent-item',content:[{type:'Text',text:'The ordinary answer'}],phase:'final_answer'},completed_at_ms:1792929601000}],['event_msg',{type:'task_complete',turn_id:turn,last_agent_message:'The ordinary answer'}]];
 await writeFile(rollout,rows.map(([type,payload],ordinal)=>JSON.stringify({timestamp:'2026-10-25T12:00:00Z',ordinal,type,payload})).join('\n')+'\n');await writeFile(join(home,'config.toml'),'sqlite_home='+JSON.stringify(sql)+'\nmodel="gpt-6.1-sol"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="offline-fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
 execFileSync('/usr/bin/python3',['-c',`import json,sqlite3,pathlib,sys
schema=json.load(open(sys.argv[1]));root=pathlib.Path(sys.argv[2])
for name,s in schema.items():
 c=sqlite3.connect(root/name)
 if 'sqlite_sequence' in s['schema']:c.execute('CREATE TABLE temporary_sequence(id INTEGER PRIMARY KEY AUTOINCREMENT)');c.execute('DROP TABLE temporary_sequence')
 for key,sql in s['schema'].items():
  if key!='sqlite_sequence' and sql.startswith('CREATE TABLE'):c.execute(sql)
 for key,sql in s['schema'].items():
  if not sql.startswith('CREATE TABLE'):c.execute(sql)
 for m in s['migrations']:c.execute('INSERT INTO _sqlx_migrations VALUES (?,?,CURRENT_TIMESTAMP,1,?,0)',(m['version'],m['description'],bytes.fromhex(m['sha384'])))
 c.commit();c.close()
c=sqlite3.connect(root/'state_5.sqlite');c.execute('INSERT INTO threads(id,rollout_path,created_at,updated_at,source,model_provider,cwd,title,sandbox_policy,approval_mode,cli_version,history_mode) VALUES (?,?,1,1,?,?,?,?,?,?,?,?)',(sys.argv[3],sys.argv[4],'cli','fixture',sys.argv[5],'Synthetic','{"type":"read-only"}','never','0.159.1','paginated'));c.commit();c.close()
`,resolve('src/host/codex-schema-01591.json'),sql,id,rollout,task.cwd]);
 const fence=new WriterAdmissionFence({writerClasses:['native','platform'],uncoveredWriters:[],probe:async()=>({known:true})}),adapter=new CodexNativeRecoveryAdapter({scope:'alice',workspaces:store,codexHome:home,sqliteHome:sql,cliVersion:'0.159.1',restoreConfiguration:options?.personalConfiguration,fence,sourceCustody:async()=>({known:true})});
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),adapter});return {root,home,sql,store,task:current,id,rollout,fence,adapter,coordinator};
}
export async function nativeReadResume(f:Awaited<ReturnType<typeof codexFixture>>){
 const runtime=process.env.PI_COFFEE_TEST_CODEX_ROOT!,cli=await realpath(join(runtime,'node_modules','.bin','codex')),broker=join(f.root,'native-probe-authority-'+randomUUID());await mkdir(broker,{mode:0o700});const custody=new ManagedNativeCustody(join(broker,'custody'),{lock:join(broker,'group.lock'),sourceParent:f.root,sources:[f.home,f.sql,join(f.root,'alice')].map(path=>({path,destination:path})),runtimeRoots:[dirname(dirname(process.execPath)),runtime],environment:{HOME:f.home,CODEX_HOME:f.home,PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},cwd:f.task.cwd});
 const launch=await custody.prepare({executable:process.execPath,args:[cli,'app-server','--stdio']}),child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:['pipe','pipe','pipe']});const responses:any[]=[];let pending='',errors='',n=0;child.stdout.on('data',chunk=>{pending+=String(chunk);let newline;while((newline=pending.indexOf('\n'))>=0){responses.push(JSON.parse(pending.slice(0,newline)));pending=pending.slice(newline+1);}});child.stderr.on('data',chunk=>errors+=String(chunk));
 const call=async(method:string,params:unknown)=>{const id=++n;child.stdin.write(JSON.stringify({id,method,params})+'\n');await expect.poll(()=>responses.find(row=>row.id===id)??null,{timeout:15000}).not.toBeNull();const response=responses.find(row=>row.id===id);expect(response.error,errors).toBeUndefined();return response.result;};
 try{await call('initialize',{clientInfo:{name:'backup_synthetic_fixture',version:'0.0.1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');const before=await call('thread/read',{threadId:f.id,includeTurns:true});expect(before.thread.id,errors).toBe(f.id);const resumed=await call('thread/resume',{threadId:f.id,cwd:f.task.cwd,modelProvider:'fixture',sandbox:'read-only',approvalPolicy:'never'});expect(resumed.thread.id).toBe(f.id);const after=await call('thread/read',{threadId:f.id,includeTurns:true});expect(after.thread.turns.flatMap((t:any)=>t.items).map((item:any)=>item.id)).toEqual(['original-user-item','original-agent-item']);}
 finally{if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.stdin.end();const timer=setTimeout(()=>child.kill('SIGTERM'),5000);await exit;clearTimeout(timer);}await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');}
}

export async function preparedCodexRecovery(binary:string,hooks?:{personalConfiguration?:boolean;populate?:(f:Awaited<ReturnType<typeof codexFixture>>)=>Promise<void>;lose?:(f:Awaited<ReturnType<typeof codexFixture>>)=>Promise<void>}){
 const f=await codexFixture({personalConfiguration:hooks?.personalConfiguration});await f.store.createChatConversation('neighbor','codex');const other=new Workspaces(join(f.root,'bob','projects'));await other.createChatConversation('other-account','codex');
 await writeFile(join(f.home,'session_index.jsonl'),JSON.stringify({id:f.id,thread_name:'Recovered ordinary task',updated_at:'2026-10-25T12:00:00Z'})+'\n');
 await hooks?.populate?.(f);expect((await f.coordinator.capture('alice',f.task.id,'codex')).state).toBe('protected');const disk=join(f.root,'disk');await mkdir(disk,{mode:0o700});const repository=new BackupRepository({root:join(f.root,'repository'),coordinator:f.coordinator});await repository.configure({destination:disk,binary});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());const job=await repository.backup([{scope:'alice',taskId:f.task.id}]);
 execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('DELETE FROM threads WHERE id=?',(sys.argv[2],));c.commit();c.close()",join(f.sql,'state_5.sqlite'),f.id]);
 await rm(join(f.home,'session_index.jsonl'));await hooks?.lose?.(f);await f.store.archive(f.task.id,true);await f.store.deleteWorkspace(f.task.id,f.task.id,()=>rm(f.rollout),true);
 const restore=new RestoreCoordinator({root:join(f.root,'restores'),repository,authorize:async(actor,scope,manage)=>scope==='alice'&&(actor==='awangs'||!manage&&actor==='alice'),scope:async()=>({workspaces:f.store,adapter:f.adapter})});const request=await restore.request('alice','alice',{taskId:f.task.id,jobId:job.id});const plan=await restore.operate('awangs',request.id,{action:'plan',revision:1});await restore.operate('awangs',request.id,{action:'approve',revision:1,digest:plan.digest});return {...f,other,restore,plan,repository};
}

/** Two independently registered native engines share one verified fixture cut. */
export async function groupCodexWithPi(f:Awaited<ReturnType<typeof codexFixture>>){
 const other=new Workspaces(join(f.root,'synthetic-pi','projects'));await other.createChatConversation('pi-member');const task=(await other.lookup('pi-member'))!,native=join(f.root,'synthetic-pi','sessions'),agent=join(f.root,'synthetic-pi','agent');await mkdir(native,{mode:0o700});await mkdir(agent,{mode:0o700});SessionManager.create(task.cwd,native,{id:'synthetic-pi-native'}).appendMessage({role:'user',content:'Other account private history',timestamp:1});await other.setNativeBinding(task.id,{state:'bound',id:'synthetic-pi-native'});
 const pi=new PiNativeRecoveryAdapter({scope:'synthetic-pi',workspaces:other,sessionDir:native,agentDir:agent,fence:f.fence,sourceCustody:async()=>({known:true})});
 f.coordinator=new BackupCoordinator({root:join(f.root,'checkpoints'),adapter:new GroupedRecoveryAdapter({groupId:'shared-pi-codex-fixture',fence:f.fence,inventory:async()=>[{scope:'alice',taskId:f.task.id,engine:'codex'},{scope:'synthetic-pi',taskId:task.id,engine:'pi'}],resolve:(scope,id)=>scope==='alice'?f.adapter.resolve(scope,id):pi.resolve(scope,id)})});return {other,task};
}
