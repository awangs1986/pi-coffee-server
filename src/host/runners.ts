import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runRunner, type RunnerOperation} from './runner-ssh.js';

export interface Runner {id:string;name:string;host:string;port:number;username:string;platform:'linux'|'wsl'|'windows';workdir:string;credentialFile?:string;}
type RunnerView=Omit<Runner,'credentialFile'>&{hasPassword:boolean};
const idPattern=/^[a-f0-9-]{36}$/;
const text=(value:unknown,max:number)=>typeof value==='string' && value.length<=max && !/[\x00-\x1f\x7f]/.test(value);
function validate(input:unknown):Omit<Runner,'id'|'credentialFile'>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid runner');
 const r=input as Record<string,unknown>;
 if(!text(r.name,80)||!(r.name as string).trim())throw new Error('Enter a server name');
 if(typeof r.host!=='string'||r.host.length>253||! /^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|[a-fA-F0-9]*:[a-fA-F0-9:]+)$/.test(r.host))throw new Error('Invalid SSH host');
 if(typeof r.username!=='string'||! /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(r.username))throw new Error('Invalid SSH username');
 if(!Number.isInteger(r.port)||Number(r.port)<1||Number(r.port)>65535)throw new Error('Invalid SSH port');
 if(!['linux','wsl','windows'].includes(String(r.platform)))throw new Error('Invalid platform');
 if(!text(r.workdir,1024))throw new Error('Invalid working directory');
 if(r.workdir && !(r.platform==='windows'? /^(?:[a-zA-Z]:[\\/]|\\\\)/ : /^\//).test(String(r.workdir)))throw new Error('Use an absolute working directory');
 return {name:(r.name as string).trim(),host:r.host,username:r.username,port:Number(r.port),platform:r.platform as Runner['platform'],workdir:r.workdir as string};
}
const view=({credentialFile,...runner}:Runner):RunnerView=>({...runner,hasPassword:Boolean(credentialFile)});

/** Private per-user state, outside every task's checkout and file-transfer root. */
export class RunnerManager {
 readonly root:string;
 readonly configPath:string;
 private writes:Promise<unknown>=Promise.resolve();
 private testing=false;
 constructor(root:string){this.root=resolve(root);this.configPath=join(this.root,'runners.json');}
 private async rows():Promise<Runner[]>{
  try {const value=JSON.parse(await readFile(this.configPath,'utf8'));if(value.version!==1||!Array.isArray(value.runners))throw new Error('Unsupported runner configuration');return value.runners;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 }
 private async atomic(path:string,content:string){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,content,{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
 }
 private async persist(runners:Runner[]){
  const cli=fileURLToPath(new URL('./runner-cli.js',import.meta.url));
  await this.atomic(this.configPath,JSON.stringify({version:1,
   usage:{command:[process.execPath,cli,'--config',this.configPath],operations:['list','exec <id> [--env windows|wsl] -- <shell command>','upload <id> <local path> <absolute remote path>','download <id> <absolute remote path> <local path>'],notes:'Read this file when remote execution is needed. Execute the command array without concatenating unquoted shell arguments. Use the CLI so credentials stay out of command arguments. One Windows computer provides both environments through the same Windows SSH connection. exec defaults to PowerShell; for Linux use exec <id> --env wsl -- <command>, which invokes wsl.exe and sh in the Windows SSH user’s default distribution. WSL needs no separate IP, credentials or SSH daemon. Use --env wsl commands to change to a Linux working directory if needed. Test Windows and WSL readiness before Linux work; report an unavailable distribution. Upload/download use Windows SFTP paths (for example C:/coffee/file.txt); access those files from WSL through /mnt/c/coffee/file.txt, or copy them to/from Linux storage with a WSL command. Remote changes persist. Existing SSH agent/default keys are used when no password is stored.'},
   runners},null,2)+'\n');
 }
 private serial<T>(operation:()=>Promise<T>):Promise<T>{const next=this.writes.then(operation);this.writes=next.catch(()=>undefined);return next;}
 async instruction():Promise<string|undefined>{return this.serial(async()=>{
  const rows=await this.rows();if(!rows.length)return undefined;
  // A newly started native session resolves the CLI in the current Host release.
  await this.persist(rows);
  return `For remote execution or testing, read the runner configuration at ${this.configPath}.`;
 });}
 async list(){await this.writes;return {runners:(await this.rows()).map(view)};}
 async handle(input:Record<string,unknown>):Promise<unknown>{
  if(input.action==='list')return this.list();
  if(input.action==='sshme'){
   if(typeof input.request!=='string'||!input.request.trim()||input.request.length>65536||input.request.includes('\0'))throw new Error('请输入 /sshme 后需要协助的内容');
   await this.writes;
   const row=(await this.rows()).find(r=>r.id===input.id);
   if(!row||row.platform!=='windows')throw new Error('请先配置你的 Windows SSH 连接');
   const tested=await this.handle({action:'test',id:row.id}) as {ok:boolean;message:string;wslReady?:boolean};
   if(!tested.ok)throw new Error(tested.message);
   const pointer=await this.instruction();
   const latest=(await this.rows()).find(r=>r.id===row.id);
   if(JSON.stringify(latest)!==JSON.stringify(row))throw new Error('连接配置已改变，请重新确认');
   const target=JSON.stringify({id:row.id,host:row.host,port:row.port,username:row.username});
   return {prompt:`Remote assistance request: ${input.request.trim()}\n\n[SSHME remote assistance]\nThe target is the Web user's Windows computer, not your Linux Host. The user confirmed this SSH target: ${target}.\n${pointer}\nRead that configuration and use its CLI with this runner ID; verify the saved endpoint still matches the confirmed target before each operation, and ask the user if it changed. Perform this request on that remote computer, not on the Host. Use PowerShell for Windows or the same computer's WSL for Linux; WSL was ${tested.wslReady?'available':'not ready'} during the connection test. Keep passwords out of messages and command arguments. The user authorized the requested assistance, not unrelated changes.`,message:tested.message};
  }
  if(input.action==='test'){
   if(this.testing)throw new Error('A connection test is already running');this.testing=true;
   try{
    const ready=(result:{code:number;stdout:string})=>result.code===0&&result.stdout.split(/\r?\n/).includes('coffee-runner-ready');
    const result=await this.run(String(input.id),{kind:'test'});
    if(!ready(result))return {ok:false,code:result.code,message:'Windows 连接失败，请检查 SSH 地址、认证、工作目录和主机密钥。'};
    const row=(await this.rows()).find(r=>r.id===input.id);
    if(row?.platform!=='windows')return {ok:true,message:'旧连接正常；请重新配置 Windows 电脑以使用 WSL。'};
    let wslReady=false;
    try{wslReady=ready(await this.run(String(input.id),{kind:'test',environment:'wsl'}));}catch{}
    return {ok:true,wslReady,message:wslReady?'Windows 连接正常；WSL 可用。':'Windows 连接正常；WSL 未就绪，请检查该 Windows 用户的默认发行版。'};
   }
   finally{this.testing=false;}
  }
  if(input.action!=='save'&&input.action!=='delete')throw new Error('Unknown runner action');
  return this.serial(async()=>{
   const rows=await this.rows();
   if(input.action==='delete'){
    const row=rows.find(r=>r.id===input.id);if(!row)throw new Error('Unknown runner');
    await this.persist(rows.filter(r=>r.id!==row.id));if(row.credentialFile)await rm(row.credentialFile,{force:true});return {ok:true};
   }
   const value=validate(input.runner),r=input.runner as Record<string,unknown>;
   if(value.platform!=='windows')throw new Error('请配置 Windows 电脑；Linux 通过这台电脑的 WSL 运行');
   if(r.password!==undefined&&(!text(r.password,4096)))throw new Error('Invalid SSH password');
   if(r.clearPassword!==undefined&&typeof r.clearPassword!=='boolean')throw new Error('Invalid password option');
   const existing=r.id===undefined?undefined:rows.find(row=>row.id===r.id);
   if(r.id!==undefined&&(!idPattern.test(String(r.id))||!existing))throw new Error('Unknown runner');
   if(existing?.credentialFile && !r.password && !r.clearPassword && ['host','port','username'].some(key=>existing[key as keyof Runner]!==value[key as keyof typeof value]))throw new Error('SSH 地址或用户已改变，请重新输入密码或明确选择 SSH 密钥');
   if(!existing&&rows.length>=1)throw new Error('只需配置一台 Windows 电脑，请编辑现有配置');
   await mkdir(this.root,{recursive:true,mode:0o700});await chmod(this.root,0o700);
   const id=existing?.id??randomUUID();
   // A replacement gets its own file so a failed config write cannot change the old credential.
   const replacement=typeof r.password==='string'&&r.password.length>0?join(this.root,`${id}.${randomUUID()}.password`):undefined;
   const credentialFile=replacement??(r.clearPassword?undefined:existing?.credentialFile);
   const row:Runner={id,...value,...(credentialFile?{credentialFile}:{})};
   try{
    if(replacement)await this.atomic(replacement,String(r.password));
    await this.persist([...rows.filter(item=>item.id!==id),row]);
   }catch(error){if(replacement)await rm(replacement,{force:true});throw error;}
   if(existing?.credentialFile&&existing.credentialFile!==credentialFile)await rm(existing.credentialFile,{force:true});
   return {runner:view(row)};
  });
 }
 async run(id:string,operation:RunnerOperation){
  // Serialize credential reads against replacement/deletion; execution itself does not block saves.
  const {runner,password}=await this.serial(async()=>{
   const row=(await this.rows()).find(r=>r.id===id);if(!row)throw new Error('Unknown runner');
   return {runner:{...row,...validate(row)},password:row.credentialFile?await readFile(row.credentialFile,'utf8'):undefined};
  });
  return runRunner(runner,password,join(this.root,'known_hosts'),operation);
 }
}
