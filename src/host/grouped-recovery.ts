import {createHash} from 'node:crypto';
import {BackupError,validateNativeRecoveryGroup,verifySealedCheckpoint,type CaptureLease,type CheckpointManifest,type NativeRecoveryAdapter,type NativeRecoveryGroup,type RecoveryMember,type RecoverySource,type SealedCheckpoint,type WriterAdmissionFence} from './backup.js';
import type {AgentEngine} from '../shared/protocol.js';

export interface GroupedRecoveryMember {scope:string;taskId:string;engine:AgentEngine;}
const key=(member:{scope:string;taskId:string})=>member.scope+'\0'+member.taskId;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=()=>new BackupError('closure_incomplete','Shared native source closure is not complete');
function canonical(members:GroupedRecoveryMember[]){return JSON.stringify([...members].sort((a,b)=>key(a).localeCompare(key(b))));}
/** Inventory and every per-member buffer/logical native export are built inside
 * one real coordinator cut. No independent point receives a shared timestamp. */
export class GroupedRecoveryAdapter implements NativeRecoveryAdapter {
 readonly version='coffee-shared-native-cut-v1';
 constructor(private options:{groupId:string;fence:WriterAdmissionFence;maxBytes?:number;maxFiles?:number;inventory:()=>Promise<GroupedRecoveryMember[]>;resolve:(scope:string,taskId:string)=>Promise<NativeRecoveryGroup>}){}
 async resolve(scope:string,taskId:string):Promise<NativeRecoveryGroup>{
  return {groupId:this.options.groupId,adapterVersion:this.version,fence:this.options.fence,members:[],sources:[],validate:async()=>{throw fail();},materialize:lease=>this.materialize(scope,taskId,lease)};
 }
 private async materialize(scope:string,taskId:string,lease:CaptureLease):Promise<NativeRecoveryGroup>{
  lease.assertValid();const inventory=await this.options.inventory();lease.assertValid();const seen=new Set<string>();if(!inventory.length||inventory.length>10000||!inventory.some(member=>member.scope===scope&&member.taskId===taskId))throw fail();
  for(const member of inventory){if(!['pi','codex'].includes(member.engine)||seen.has(key(member)))throw fail();seen.add(key(member));}
  const revision=canonical(inventory),members:RecoveryMember[]=[],sources:RecoverySource[]=[],children:NativeRecoveryGroup[]=[];let materializedBytes=0,sourceCount=0;
  for(const item of [...inventory].sort((a,b)=>key(a).localeCompare(key(b)))){
   lease.assertValid();let child=await this.options.resolve(item.scope,item.taskId);lease.assertValid();if(child.fence!==this.options.fence)throw fail();if(child.materialize){const header=child;child=await child.materialize(lease);lease.assertValid();if(child.materialize||child.fence!==header.fence||child.groupId!==header.groupId)throw fail();}
   validateNativeRecoveryGroup(child,item.scope,item.taskId);await child.validate();lease.assertValid();if(child.members.length!==1||child.members[0].scope!==item.scope||child.members[0].taskId!==item.taskId||child.members[0].engine!==item.engine)throw fail();
   const adapterVersion=child.members[0].adapterVersion??child.adapterVersion;if(!adapterVersion)throw fail();members.push({...child.members[0],adapterVersion});children.push(child);
   for(const source of child.sources){sourceCount++;if(source.data!==undefined)materializedBytes+=source.data.byteLength;if(materializedBytes>(this.options.maxBytes??1024**3)||sourceCount>(this.options.maxFiles??100000))throw new BackupError('resource_limit','Shared native materialization exceeds capture limits');sources.push({...source,id:'s-'+hash(key(item)+'\0'+source.id),owner:{scope:item.scope,taskId:item.taskId}});}
  }
  const validate=async()=>{lease.assertValid();if(canonical(await this.options.inventory())!==revision)throw new BackupError('capture_revoked','Shared source membership changed');for(const child of children){await child.validate();lease.assertValid();}};
  await validate();return {groupId:this.options.groupId,adapterVersion:this.version,fence:this.options.fence,members,sources,validate};
 }
}
/** Verify the original complete group seal before projecting a native adapter
 * view. The original directory/seal remain the approval/publication authority. */
export async function projectSealedCheckpointMember(point:SealedCheckpoint,scope:string,taskId:string,expectedManifestSha256?:string):Promise<SealedCheckpoint>{
 const manifest=await verifySealedCheckpoint(point.directory,expectedManifestSha256??hash(JSON.stringify(point.manifest)));const member=manifest.members.find(item=>item.scope===scope&&item.taskId===taskId);if(!member||manifest.members.filter(item=>item.scope===scope&&item.taskId===taskId).length!==1)throw fail();
 if(!manifest.sources.some(source=>source.owner!==undefined)){if(manifest.members.length!==1)throw fail();return {directory:point.directory,manifest};}
 if(manifest.sources.some(source=>!source.owner||!manifest.members.some(member=>member.scope===source.owner!.scope&&member.taskId===source.owner!.taskId)))throw fail();
 const sources=manifest.sources.filter(source=>source.owner?.scope===scope&&source.owner.taskId===taskId),objects=manifest.objects.filter(object=>sources.some(source=>object.path==='objects/'+source.id||object.path.startsWith('objects/'+source.id+'/')));
 const projection:CheckpointManifest={...manifest,adapterVersion:member.adapterVersion??manifest.adapterVersion,members:[member],sources,objects,totalBytes:objects.reduce((total,object)=>total+(object.kind==='file'?object.size:0),0)};
 for(const role of ['registry','workspace','task-data','native'])if(!sources.some(source=>source.role===role))throw fail();return {directory:point.directory,manifest:projection};
}
