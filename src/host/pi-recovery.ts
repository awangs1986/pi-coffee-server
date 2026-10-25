import {open,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {BackupError,type NativeRecoveryAdapter,type NativeRecoveryGroup,type RecoverySource,WriterAdmissionFence} from './backup.js';
import type {Workspaces,Conversation} from './workspaces.js';

/** Pi 1.1.0's durable recovery graph. Native JSONL, parent sessions and Harness
 * artifacts remain native data; display exports never stand in for them. */
export class PiNativeRecoveryAdapter implements NativeRecoveryAdapter {
 readonly version='pi-1.1.0-jsonl-v3/coffee-checkpoint-v1';
 constructor(private options:{scope:string;workspaces:Workspaces;sessionDir:string;fence:WriterAdmissionFence;sourceCustody:()=>Promise<{known:boolean;reason?:string}>}){}
 async resolve(scope:string,taskId:string):Promise<NativeRecoveryGroup>{
  if(scope!==this.options.scope)throw new BackupError('closure_incomplete','Native source scope mismatch');
  const custody=await this.options.sourceCustody();if(!custody.known)throw new BackupError('writers_unknown',custody.reason??'Native source custody unknown');
  const task=await this.options.workspaces.lookup(taskId);if(!task||(task.engine??'pi')!=='pi')throw new BackupError('closure_incomplete','Pi task binding unavailable');
  assertTask(task);await this.options.workspaces.file(task.id,'');
  const state=await this.options.workspaces.list(),project=state.projects.find(p=>p.id===task.projectId);
  const registry=JSON.stringify({schemaVersion:1,scope,conversation:task,project});
  const root=resolve(this.options.sessionDir);if(await realpath(root)!==root)throw new BackupError('unsafe_source','Native source path changed');
  const names=await readdir(root),byId=new Map<string,{path:string;header:PiHeader}>();
  for(const name of names.filter(n=>n.endsWith('.jsonl'))){const path=join(root,name),header=await readHeader(path);if(byId.has(header.id))throw new BackupError('closure_incomplete','Duplicate native identity');byId.set(header.id,{path,header});}
  const required=new Set([task.nativeBinding?.id??task.id,...task.retainedNativeIds??[],...task.takeoverSegments?.flatMap(s=>s.nativeId?[s.nativeId]:[])??[]]);
  const selected=new Map<string,{path:string;header:PiHeader}>(),pending=[...required];
  while(pending.length){const id=pending.pop()!;if(selected.has(id))continue;const source=byId.get(id);if(!source)throw new BackupError('closure_incomplete','Required native binding missing');selected.set(id,source);
   if(source.header.parentSession){const parent=resolve(source.header.parentSession),rel=relative(root,parent);if(rel.startsWith('..')||isAbsolute(rel))throw new BackupError('closure_incomplete','Native parent is outside the owned store');const header=await readHeader(parent);if(!byId.has(header.id)||byId.get(header.id)!.path!==parent)throw new BackupError('closure_incomplete','Unregistered native parent');pending.push(header.id);}
  }
  const sources:RecoverySource[]=[{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from(registry)},{id:'workspace',recoveryKey:'workspace',role:'workspace',path:task.cwd},{id:'task-data',recoveryKey:'task-data',role:'task-data',path:task.taskRoot??task.cwd}];
  for(const [id,source]of selected){const name='pi-'+createHash('sha256').update(id).digest('hex').slice(0,24);sources.push({id:name,recoveryKey:'native-session/'+id,role:'native',path:source.path});const artifacts=join(root,'artifacts',id);const info=await lstat(artifacts).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return undefined;});if(info){if(!info.isDirectory()||info.isSymbolicLink())throw new BackupError('unsafe_source','Native artifacts path changed');sources.push({id:name+'-artifacts',recoveryKey:'native-artifacts/'+id,role:'native',path:artifacts});}}
  // Git worktrees / alternates are external graphs, not self-contained clones.
  const git=await lstat(join(task.cwd,'.git')).catch(()=>undefined);
  if(git&&!git.isDirectory())throw new BackupError('closure_incomplete','External Git storage is not closed');
  if(git&&await lstat(join(task.cwd,'.git','objects','info','alternates')).then(()=>true,()=>false))throw new BackupError('closure_incomplete','Git alternates are not closed');
  const identity=JSON.stringify(task),headers=JSON.stringify([...selected].map(([id,s])=>[id,s.header]));
  return {groupId:'pi-'+createHash('sha256').update(root).digest('hex').slice(0,32),fence:this.options.fence,members:[{scope,taskId,engine:'pi',nativeBindings:[...selected.keys()].sort()}],sources,validate:async()=>{
   const current=await this.options.workspaces.lookup(taskId);if(!current||JSON.stringify(current)!==identity)throw new BackupError('capture_revoked','Task binding changed');assertTask(current);
   const currentHeaders=[];for(const [id,s]of selected)currentHeaders.push([id,await readHeader(s.path)]);
   if(JSON.stringify(currentHeaders)!==headers)throw new BackupError('capture_revoked','Native graph changed');
   const proof=await this.options.sourceCustody();if(!proof.known)throw new BackupError('writers_unknown','Native source custody changed');
  }};
 }
}
interface PiHeader {type:'session';version:3;id:string;timestamp:string;cwd:string;parentSession?:string;}
async function readHeader(path:string):Promise<PiHeader>{
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||await realpath(path)!==resolve(path))throw new BackupError('unsafe_source','Unsafe native source');
 const file=await open(path,'r');try{const info=await file.stat();if(info.ino!==before.ino||info.dev!==before.dev)throw new BackupError('capture_revoked','Native source changed');const buffer=Buffer.alloc(64*1024),{bytesRead}=await file.read(buffer,0,buffer.length,0);const text=buffer.subarray(0,bytesRead).toString('utf8'),line=text.indexOf('\n');if(line<0&&bytesRead===buffer.length)throw new BackupError('closure_incomplete','Native header too large');const header=JSON.parse(line<0?text:text.slice(0,line));if(header.type!=='session'||header.version!==3||typeof header.id!=='string'||!header.id||typeof header.cwd!=='string'||typeof header.timestamp!=='string'||(header.parentSession!==undefined&&typeof header.parentSession!=='string'))throw new BackupError('closure_incomplete','Unsupported native Pi schema');return header;}finally{await file.close();}
}
function assertTask(task:Conversation){
 if(task.cleanupStarted||task.workspaceRemoved||task.creationState==='creating'||task.creationState==='failed'||task.takeover?.status==='preparing'||task.fork?.status==='preparing'||task.forking?.status==='preparing'||task.nativeBinding?.state==='starting'||task.nativeBinding?.state==='prepared')throw new BackupError('writers_active','Task lifecycle is changing');
 if(task.takeoverSegments?.some(s=>s.from!=='pi'||s.to!=='pi'))throw new BackupError('closure_incomplete','Historical engine requires its recovery adapter');
}
