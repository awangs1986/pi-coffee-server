export interface GitEmailRepair {originalHead:string;head:string;backupRef:string;rewritten:number;anchor:boolean}
export function isEmailPrivacyRejection(error:unknown):boolean;
export function githubPrivateEmail(account?:{githubId:string;login:string}):string;
export function repairGitEmailPrivacy(options:{git:(args:string[],input?:Buffer)=>Promise<Buffer>;branch:string;expectedHead:string;email:string}):Promise<GitEmailRepair>;
export function anonymousGitCommit(git:(args:string[],input?:Buffer)=>Promise<Buffer>,options:{tree:string;parent?:string;email:string;message:string}):Promise<string>;
