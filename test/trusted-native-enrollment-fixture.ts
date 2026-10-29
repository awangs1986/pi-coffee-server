import {expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {Workspaces} from '../src/host/workspaces.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {TrustedSourceAuthority} from '../src/host/trusted-source-authority.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {readNativeSourceHandoff} from '../src/host/native-source-handoff.js';

export async function existingPi(options:{authorize?:(actor:string)=>Promise<boolean>}={}){
 const source=await mkdtemp(join(tmpdir(),'existing-pi-source-')),control=await mkdtemp(join(tmpdir(),'existing-pi-control-')),sessions=join(source,'sessions'),agent=join(source,'agent');
 const lock=join(control,'group.lock'),custody=new NativeWriterCustody(join(control,'custody'),{lock}),physical=new PhysicalWriterFence({lock,custody});
 await mkdir(sessions,{mode:0o700});await mkdir(agent,{mode:0o700});const workspaces=new Workspaces(join(source,'projects'),{gitCommandCustody:custody});const task=await workspaces.createChatConversation('original-task');
 const stored=SessionManager.create(task.cwd,sessions,{id:task.id});stored.appendMessage({role:'user',content:'Existing native context',timestamp:1});await writeFile(join(task.cwd,'note'),'first');
 const configuration=join(control,'configuration.json'),graph=join(control,'graph.json');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'native-group',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'source',path:source}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'native-group',roots:[{id:'source',scope:'awangs',engine:'pi'}]}),{mode:0o600});
 const open=(selected=physical)=>TrustedSourceAuthority.open({root:join(control,'authority'),configuration,graph,fence:selected,authorize:options.authorize??(async actor=>actor==='awangs')});
 const authority=await open(),fence=authority.writerFence('host');workspaces.setBackupWriterFence(fence);
 const factory=new RpcPiSessionFactory({cwd:task.cwd,sessionDir:sessions,agentDir:agent,nativeCustody:custody,writerFence:fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
 const scopes=[{scope:'awangs',workspaces,pi:{sessionDir:sessions,agentDir:agent}}],checkpointRoot=join(control,'checkpoints');
 return {lock,source,control,sessions,agent,workspaces,task,stored,configuration,graph,custody,physical,authority,open,fence,factory,scopes,checkpointRoot,cleanup:async()=>{await authority.close();await rm(source,{recursive:true,force:true});await rm(control,{recursive:true,force:true});}};
}

export async function normalPiHandoff(f:Awaited<ReturnType<typeof existingPi>>){
 const session=await f.factory.create({sessionId:f.task.id,requireExisting:true});try{await session.getHistory();}finally{await session.stop();}await expect.poll(async()=>(await f.custody.state()).state,{timeout:10000}).toBe('quiescent');return readNativeSourceHandoff({custody:f.custody,fence:f.physical});
}

export async function crashedLocalHost(f:Awaited<ReturnType<typeof existingPi>>,mode:'qualified'|'bootstrap'|'restart-startup'|'delegated',operationId='interrupted-local'){
 const script=join(f.control,'crash-host.mjs'),module=(name:string)=>JSON.stringify(pathToFileURL(resolve('dist/src/host/'+name+'.js')).href);
 await f.authority.close();await writeFile(script,`
import {writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {TrustedSourceAuthority} from ${module('trusted-source-authority')};
import {NativeWriterCustody} from ${module('native-custody')};
import {PhysicalWriterFence} from ${module('physical-writer-fence')};
import {Workspaces} from ${module('workspaces')};
import {readNativeSourceHandoff} from ${module('native-source-handoff')};
const f=JSON.parse(process.argv[2]),custody=new NativeWriterCustody(join(f.control,'custody'),{lock:f.lock}),physical=new PhysicalWriterFence({lock:f.lock,custody});
const authority=await TrustedSourceAuthority.open({root:join(f.control,'authority'),configuration:f.configuration,graph:f.graph,fence:physical,authorize:async actor=>actor==='awangs'});
const workspaces=new Workspaces(f.projects,{gitCommandCustody:custody});workspaces.setBackupWriterFence(authority.writerFence('host'));await workspaces.list();
const scopes=[{scope:'awangs',workspaces,pi:{sessionDir:f.sessions,agentDir:f.agent}}];
if(f.mode==='qualified'||f.mode==='delegated')await authority.qualifyExisting('awangs',{producer:'host',handoff:await readNativeSourceHandoff({custody,fence:physical}),scopes,checkpointRoot:f.checkpointRoot});
await authority[f.mode==='delegated'?'runDelegated':'runWriter']('host',f.operationId,async()=>{await appendFile(join(f.control,'effects'),'once'+String.fromCharCode(10));await writeFile(f.note,'partial durable work');process.stdout.write('admitted\\n');setTimeout(()=>process.exit(0),20);await new Promise(()=>{});});
`,{mode:0o600});
 const child=spawn(process.execPath,[script,JSON.stringify({control:f.control,lock:f.lock,configuration:f.configuration,graph:f.graph,projects:f.workspaces.root,sessions:f.sessions,agent:f.agent,checkpointRoot:f.checkpointRoot,note:join(f.task.cwd,'note'),mode,operationId})],{stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout!.on('data',chunk=>output+=String(chunk));child.stderr!.on('data',chunk=>errors+=String(chunk));
 const exited=once(child,'exit');const timeout=setTimeout(()=>child.kill('SIGKILL'),20000);try{expect((await exited)[0],errors).toBe(0);expect(output).toContain('admitted');}finally{clearTimeout(timeout);}
}

export async function reopen(f:Awaited<ReturnType<typeof existingPi>>){
 const custody=new NativeWriterCustody(f.custody.root,{lock:f.lock}),physical=new PhysicalWriterFence({lock:f.lock,custody}),authority=await f.open(physical),workspaces=new Workspaces(f.workspaces.root,{gitCommandCustody:custody});workspaces.setBackupWriterFence(authority.writerFence('host'));await workspaces.list();
 return {authority,custody,physical,options:{producer:'host',handoff:await readNativeSourceHandoff({custody,fence:physical}),scopes:[{...f.scopes[0],workspaces}],checkpointRoot:f.checkpointRoot}};
}

