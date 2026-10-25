import {BackupError,LEGACY_BACKUP_SCOPE} from './backup.js';
import type {RepositoryPoint} from './backup-repository.js';
import {normalizeUsername} from '../shared/identity.js';
export interface RetentionSnapshot {snapshotId:string;jobIds:string[];verified:boolean;points:RepositoryPoint[];}
export interface RecoveryPin {schema:1;id:string;operationId:string;revision:number;jobId:string;snapshotId:string;scopes:string[];createdAt:string;expiresAt:string;releasedAt?:string;activeLease?:boolean;}
export type RetentionReason={kind:'daily'|'weekly'|'monthly';scope:string;period:string}|{kind:'last-complete';scope:string;taskId:string}|{kind:'pin'|'active-pin';pinId:string}|{kind:'outside-scope'|'unverified'};
export interface RetentionDecision {policy:{daily:30;weekly:12;monthly:12};timeZone:string;scopes:string[];keep:{snapshotId:string;reasons:RetentionReason[]}[];remove:{snapshotId:string;jobIds:string[];scopes:string[]}[];pins:RecoveryPin[];}
export interface RecoveryPinLease {assertHeld():void;}
export interface RepositoryRetentionPlan extends RetentionDecision {schema:1;id:string;revision:number;createdAt:string;repositoryId:string;catalogDigest:string;digest:string;state:'previewed'|'executing'|'completed'|'failed';phase:'preview'|'forgetting'|'pruning'|'journal'|'complete';deletedSnapshotIds:string[];finishedAt?:string;errorCode?:string;}
/** Public policy seam: selects exact snapshot identities from a verified catalog.
 * Capture times select buckets; storage completion never makes old material new. */
export function planRetention(records:RetentionSnapshot[],pins:RecoveryPin[],input:{scopes:string[];now:number;timeZone?:string}):RetentionDecision{
 const timeZone=input.timeZone??'America/Toronto';
 if(!Array.isArray(input.scopes)||!input.scopes.length||input.scopes.length>256||new Set(input.scopes).size!==input.scopes.length||input.scopes.some(scope=>scope!==LEGACY_BACKUP_SCOPE&&normalizeUsername(scope)!==scope)||!Number.isFinite(input.now)||records.length>100000||pins.length>100000)throw new BackupError('invalid_retention','Invalid retention selection');
 const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const scopes=[...input.scopes].sort(),allowed=new Set(scopes),reasons=new Map<string,RetentionReason[]>();
 const keep=(id:string,reason:RetentionReason)=>{const list=reasons.get(id)??[];if(!list.some(value=>JSON.stringify(value)===JSON.stringify(reason)))list.push(reason);reasons.set(id,list);};
 const catalog=new Map<string,RetentionSnapshot>();
 for(const record of records){
  if(!/^[a-f0-9]{64}$/.test(record.snapshotId)||catalog.has(record.snapshotId)||!Array.isArray(record.points)||!Array.isArray(record.jobIds))throw new BackupError('retention_catalog_invalid','Retention catalog is invalid');
  for(const point of record.points)if(!Number.isFinite(Date.parse(point.captureAt))||!point.scope||!point.taskId)throw new BackupError('retention_catalog_invalid','Retention point is invalid');
  catalog.set(record.snapshotId,record);
  if(!record.verified||!record.points.length||record.points.some(point=>!['pi','codex'].includes(point.engine)))keep(record.snapshotId,{kind:'unverified'});
  if(record.points.some(point=>!allowed.has(point.scope)))keep(record.snapshotId,{kind:'outside-scope'});
 }
 for(const pin of pins){if(!catalog.has(pin.snapshotId))continue;if(!Number.isFinite(Date.parse(pin.expiresAt)))throw new BackupError('retention_pin_invalid','Recovery pin cannot be evaluated');if(pin.activeLease)keep(pin.snapshotId,{kind:'active-pin',pinId:pin.id});else if(!pin.releasedAt&&Date.parse(pin.expiresAt)>input.now)keep(pin.snapshotId,{kind:'pin',pinId:pin.id});}
 for(const scope of scopes){
  const candidates=records.filter(record=>record.verified&&record.points.some(point=>point.scope===scope)&&record.points.every(point=>['pi','codex'].includes(point.engine))).map(record=>({record,time:Math.min(...record.points.filter(point=>point.scope===scope).map(point=>Date.parse(point.captureAt)))})).sort((a,b)=>b.time-a.time||b.record.snapshotId.localeCompare(a.record.snapshotId));
  const latestTasks=new Map<string,{snapshotId:string;time:number}>();
  for(const {record} of candidates)for(const point of record.points.filter(point=>point.scope===scope)){const time=Date.parse(point.captureAt),old=latestTasks.get(point.taskId);if(!old||time>old.time)latestTasks.set(point.taskId,{snapshotId:record.snapshotId,time});}
  for(const [taskId,record] of latestTasks)keep(record.snapshotId,{kind:'last-complete',scope,taskId});
  for(const [kind,count] of [['daily',30],['weekly',12],['monthly',12]] as const){
   const buckets=new Map<string,string>();for(const {record,time} of candidates){const date=format.format(new Date(time)),period=kind==='daily'?date:kind==='monthly'?date.slice(0,7):monday(date);if(!buckets.has(period))buckets.set(period,record.snapshotId);}
   for(const period of [...buckets.keys()].sort().reverse().slice(0,count))keep(buckets.get(period)!,{kind,scope,period});
  }
 }
 const ordered=[...catalog.values()].sort((a,b)=>a.snapshotId.localeCompare(b.snapshotId));
 return {policy:{daily:30,weekly:12,monthly:12},timeZone,scopes,keep:ordered.filter(record=>reasons.has(record.snapshotId)).map(record=>({snapshotId:record.snapshotId,reasons:reasons.get(record.snapshotId)!})),remove:ordered.filter(record=>!reasons.has(record.snapshotId)).map(record=>({snapshotId:record.snapshotId,jobIds:[...record.jobIds].sort(),scopes:[...new Set(record.points.map(point=>point.scope))].sort()})),pins:pins.map(pin=>({...pin}))};
}
function monday(date:string){const time=Date.parse(date+'T12:00:00Z'),day=new Date(time).getUTCDay();return new Date(time-((day+6)%7)*86400000).toISOString().slice(0,10);}
