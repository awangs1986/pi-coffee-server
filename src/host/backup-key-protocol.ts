/** Local requests carry authenticated Host actor separately from routed data. */
export interface BackupBrokerContext {actor:string;dataScope:string;authorityRevision:number;}
export type BackupBrokerOperation='status'|'jobs'|'configure'|'backup'|'export-recovery'|'verify-recovery'|'rotate'|'recover'|'qualification';
export interface BackupBrokerRequest {schema:1;id:string;context:BackupBrokerContext;operation:BackupBrokerOperation;scope?:string;selection?:{scope:string;taskId:string;expectedCheckpointId?:string}[];recoveryPackage?:string;}
export interface BackupBrokerPolicy {schema:1;revision:number;administrator:string;scopes:string[];actors:Record<string,{role:'administrator'|'reader';scopes:string[]}>;}
export interface BackupKeyServiceConfig {schema:1;socket:string;serviceUid:number;hostUid:number;sourceUid:number;privateRoot:string;authorityFile:string;sourceSocket:string;binary:string;destination:string;node:string;handler:string;responseLimit?:number;}
export interface BackupBrokerQualification {state:'unavailable'|'qualified';reason?:string;serviceUid:number;sourceUid:number;hostUid:number;processProtection:{dumpable:number;noNewPrivs:number};sourceRevision?:number;}
export class BackupBrokerError extends Error {constructor(readonly code:string){super('Backup broker operation refused: '+code);}}
