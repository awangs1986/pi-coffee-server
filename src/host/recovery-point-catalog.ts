import type {RepositoryJob,RepositoryPoint} from './backup-repository.js';
import {BackupError} from './backup.js';
export interface RecoveryPointQuery {limit?:number;cursor?:string;capturedFrom?:string;capturedTo?:string;}
export interface RecoveryPointRow extends RepositoryPoint {jobId:string;jobStartedAt:string;jobFinishedAt?:string;}
export interface RecoveryPointPage {points:RecoveryPointRow[];nextCursor?:string;}
const refuse=()=>new BackupError('invalid_recovery_query','Invalid retained checkpoint query');
const key=(point:RecoveryPointRow)=>[point.captureAt,point.checkpointId,point.taskId,point.jobId].join('/');
/** Public pages are bounded and contain one account. Capture time never inherits
 * the time at which an unchanged checkpoint was copied to a repository. */
export function recoveryPointPage(jobs:RepositoryJob[],scope:string,query:RecoveryPointQuery={}):RecoveryPointPage {
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(name=>!['limit','cursor','capturedFrom','capturedTo'].includes(name)))throw refuse();
 const limit=query.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw refuse();
 for(const date of [query.capturedFrom,query.capturedTo])if(date!==undefined&&(typeof date!=='string'||date.length!==24||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date))throw refuse();
 if(query.capturedFrom&&query.capturedTo&&query.capturedFrom>query.capturedTo)throw refuse();let after:string|undefined;
 if(query.cursor!==undefined){if(typeof query.cursor!=='string'||query.cursor.length>2048||!query.cursor||!/^[a-zA-Z0-9_-]+$/.test(query.cursor))throw refuse();try{const cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));if(Object.keys(cursor).sort().join(',')!=='after,from,scope,to'||cursor.scope!==scope||cursor.from!==(query.capturedFrom??null)||cursor.to!==(query.capturedTo??null)||typeof cursor.after!=='string'||cursor.after.length>1024)throw refuse();after=cursor.after;}catch{throw refuse();}}
 const retained=new Map<string,RecoveryPointRow>();
 for(const job of [...jobs].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id))){if(job.state!=='succeeded'||job.verification!=='repository-read'||job.retiredAt||!job.snapshotId)continue;for(const point of job.points){if(point.scope!==scope||query.capturedFrom&&point.captureAt<query.capturedFrom||query.capturedTo&&point.captureAt>query.capturedTo)continue;const identity=point.checkpointId+'/'+point.taskId;if(!retained.has(identity))retained.set(identity,{...point,jobId:job.id,jobStartedAt:job.startedAt,...(job.finishedAt?{jobFinishedAt:job.finishedAt}:{})});}}
 const sorted=[...retained.values()].sort((a,b)=>key(b).localeCompare(key(a))).filter(point=>after===undefined||key(point).localeCompare(after)<0),points=sorted.slice(0,limit);
 return {points,...(sorted.length>limit?{nextCursor:Buffer.from(JSON.stringify({scope,from:query.capturedFrom??null,to:query.capturedTo??null,after:key(points.at(-1)!)})).toString('base64url')}:{})};
}
