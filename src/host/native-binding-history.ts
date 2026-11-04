import {createHash} from 'node:crypto';
import {BackupError} from './backup.js';
import type {Conversation} from './workspaces.js';
import type {RecoverySource,CheckpointManifest} from './backup.js';

export type RecoveryEngine='pi'|'codex';
export interface NativeBindingHistory {schemaVersion:1;registryDigest:string;current:{engine:RecoveryEngine;id:string};bindings:{pi:string[];codex:string[]};operationIds:string[];}
export interface NativeHistoryCheckpoint {schemaVersion:1;history:NativeBindingHistory;bindings:{pi:string[];codex:string[]};}
const digest=(task:Conversation)=>createHash('sha256').update(JSON.stringify(task)).digest('hex');
const refused=()=>new BackupError('closure_incomplete','Native binding history is incomplete or ambiguous');
const valid=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
const engine=(value:unknown):value is RecoveryEngine=>value==='pi'||value==='codex';

/** Registry segment identities bind engines; retained IDs without a segment
 * require one actual owned native-store witness. Operation IDs alone never
 * become a native session or a reason to ignore an unknown retained ID. */
export function collectNativeBindingHistory(task:Conversation,inventory:{pi:readonly string[];codex:readonly string[]}):NativeBindingHistory{
 const currentEngine=task.engine??'pi',currentId=task.nativeBinding?.id??(currentEngine==='pi'?task.id:undefined);if(!engine(currentEngine)||!valid(currentId)||task.takeover?.status==='preparing')throw refused();
 const available={pi:new Set(inventory.pi),codex:new Set(inventory.codex)},bindings={pi:new Set<string>(),codex:new Set<string>()},operations=new Set<string>(),segments=task.takeoverSegments??[];
 const add=(kind:RecoveryEngine,id:unknown)=>{if(!valid(id)||!available[kind].has(id))throw refused();bindings[kind].add(id);};add(currentEngine,currentId);
 for(const retained of task.retainedNativeBindings??[]){if(!engine(retained.engine))throw refused();add(retained.engine,retained.nativeId);}
 for(const id of task.retiredOperationIds??[]){if(!valid(id))throw refused();operations.add(id);}
 for(const [index,segment]of segments.entries()){
  if(!engine(segment.from)||!engine(segment.to)||!valid(segment.id)||!valid(segment.nativeId)||!Number.isFinite(Date.parse(segment.at)))throw refused();
  const next=segments[index+1];if((next?next.from:currentEngine)!==segment.to)throw refused();add(segment.from,segment.nativeId);operations.add(segment.id);
 }
 if(task.takeover){const operation=task.takeover;if(!engine(operation.from)||!engine(operation.to)||!valid(operation.id)||!['completed','failed'].includes(operation.status))throw refused();if(operation.status==='completed'&&!segments.some(segment=>segment.id===operation.id&&segment.from===operation.from&&segment.to===operation.to))throw refused();operations.add(operation.id);if(operation.nativeId!==undefined)add(operation.to,operation.nativeId);}
 for(const id of task.retainedNativeIds??[]){if(!valid(id))throw refused();const witnesses=(['pi','codex'] as const).filter(kind=>available[kind].has(id));if(witnesses.length>1){const typed=(['pi','codex'] as const).filter(kind=>bindings[kind].has(id));if(!typed.length)throw refused();for(const kind of typed)add(kind,id);}else if(witnesses.length===1)add(witnesses[0],id);else if(!operations.has(id))throw refused();}
 return {schemaVersion:1,registryDigest:digest(task),current:{engine:currentEngine,id:currentId},bindings:{pi:[...bindings.pi].sort(),codex:[...bindings.codex].sort()},operationIds:[...operations].sort()};
}
/** This seam preserves the original registry, including its current engine.
 * Engine adapters select their typed native graph without constructing a fake
 * Conversation/Workspaces or rewriting checkpoint material. */
export function assertNativeBindingHistory(task:Conversation,value:NativeBindingHistory){
 if(!value||value.schemaVersion!==1||value.registryDigest!==digest(task)||!engine(value.current?.engine)||value.current.engine!==(task.engine??'pi')||value.current.id!==(task.nativeBinding?.id??((task.engine??'pi')==='pi'?task.id:undefined))||!Array.isArray(value.bindings?.pi)||!Array.isArray(value.bindings?.codex)||!Array.isArray(value.operationIds))throw refused();
 const expected=collectNativeBindingHistory(task,value.bindings);if(JSON.stringify(expected)!==JSON.stringify(value))throw refused();
}
export function assertNativeHistoryCheckpoint(task:Conversation,value:NativeHistoryCheckpoint,manifest:CheckpointManifest){
 if(!value||value.schemaVersion!==1||!Array.isArray(value.bindings?.pi)||!Array.isArray(value.bindings?.codex))throw refused();assertNativeBindingHistory(task,value.history);
 for(const kind of ['pi','codex'] as const){const ids=value.bindings[kind];if((ids.length===0)!==(value.history.bindings[kind].length===0)||ids.length>10000||new Set(ids).size!==ids.length||ids.some(id=>!valid(id))||value.history.bindings[kind].some(id=>!ids.includes(id)))throw refused();}
 const member=manifest.members.find(item=>item.taskId===task.id);if(!member||member.engine!==(task.engine??'pi')||JSON.stringify([...member.nativeBindings].sort())!==JSON.stringify([...new Set([...value.bindings.pi,...value.bindings.codex])].sort()))throw refused();
}
export function historySourceEngine(key:string):RecoveryEngine|'common'|'history'|undefined{
 if(['registry','workspace','task-data'].includes(key))return 'common';if(key==='native-history/engine-bindings-v1')return 'history';
 if(key.startsWith('native-session/')||key.startsWith('native-artifacts/')||key.startsWith('native-config/')||['platform/mishu/notes-only-v1','pending-inputs/notes-only'].includes(key))return 'pi';if(key==='codex/group-v1'||key.startsWith('codex/rollout/')||['session_index.jsonl','history.jsonl','memories','skills','prompts','AGENTS.md','config.toml'].some(name=>key==='codex/resource/'+name))return 'codex';
}
export function nativeHistorySources<T extends Pick<RecoverySource,'recoveryKey'>>(sources:T[],kind:RecoveryEngine){if(sources.some(source=>!historySourceEngine(source.recoveryKey)))throw refused();return sources.filter(source=>['common',kind].includes(historySourceEngine(source.recoveryKey)!));}
