import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import { mkdir, lstat, realpath, readFile, readdir, open, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {sourceGroupLockIdentity,assertSourceGroupLock,type SourceGroupLockIdentity} from './source-group-lock.js';

export interface FreshCustodyAllocation {id:string;path:string;dev:number;ino:number;uid:number;lock:string;}
export type NativeCustodyState = { state: 'quiescent' } | { state: 'active' | 'unknown'; reason: string };
const custodyInstances=new WeakSet<object>();
export const isNativeWriterCustody=(value:unknown):value is NativeWriterCustody=>typeof value==='object'&&value!==null&&custodyInstances.has(value);
const bootPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Custody of launched descendants only. This does NOT prove exclusive ownership
 * of a native store or workspace: the recovery adapter must prove that separately.
 * A live native process is a writer even when its RPC reports idle. No capture
 * operation stops a runtime or its descendants to obtain a quiescent result. */
export class NativeWriterCustody {
  readonly root: string;
  readonly groupLock?:string;
  private readonly allowUnused:boolean;
  constructor(root: string, options?:{lock:string;allowUnused?:boolean}) { this.allowUnused=options?.allowUnused===true;this.root = resolve(root);custodyInstances.add(this);if(options){if(resolve(options.lock)!==options.lock)throw Error('Source group lock must be canonical');this.groupLock=options.lock;} }

  async allocateFreshDestination():Promise<FreshCustodyAllocation>{
    if(!this.groupLock)throw Error('Destination custody requires its source lock');
    await mkdir(this.root,{mode:0o700});await this.checkedDirectory(this.root);await this.bindGroupLock();
    const info=await lstat(this.root),allocation={id:randomUUID(),path:this.root,dev:info.dev,ino:info.ino,uid:info.uid,lock:this.groupLock};
    await this.atomicJson(this.root,'allocation.json',{schema:1,...allocation,used:false});const parent=await open(dirname(this.root),'r');try{await parent.sync();}finally{await parent.close();}return allocation;
  }
  assertFreshAllocation(expected:FreshCustodyAllocation,pristine=true){
    const info=lstatSync(this.root),path=join(this.root,'allocation.json'),file=lstatSync(path);
    if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(this.root)!==this.root||info.dev!==expected.dev||info.ino!==expected.ino||info.uid!==expected.uid||(info.mode&0o077)||expected.path!==this.root||expected.lock!==this.groupLock||!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.uid!==info.uid||(file.mode&0o077)||file.size>65536)throw Error('Fresh destination custody changed');
    const value=JSON.parse(readFileSync(path,'utf8'));if(typeof value.used!=='boolean'||pristine&&value.used||JSON.stringify(value)!==JSON.stringify({schema:1,...expected,used:value.used}))throw Error('Fresh destination custody already used');
    assertSourceGroupLock(sourceGroupLockIdentity(this.groupLock!,false));
  }
  async prepare(command: { executable: string; args?: string[];cwd?:string;env?:Record<string,string|undefined>;engine?:'pi'|'codex' }): Promise<{ cliPath: string; env: Record<string,string> }> {
    if (process.platform !== 'linux') throw Error('Native writer custody requires Linux');
    if (!command.executable || !Array.isArray(command.args ?? [])) throw Error('Invalid native command');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.checkedDirectory(this.root);
    const groupLock=this.groupLock?await this.bindGroupLock():undefined;
    try{const allocation=await this.readJson(join(this.root,'allocation.json'));if(allocation.schema!==1||typeof allocation.used!=='boolean')throw Error('Invalid custody allocation');if(!allocation.used)await this.atomicJson(this.root,'allocation.json',{...allocation,used:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const id = randomUUID(), dir = join(this.root, id);
    await mkdir(dir, { mode: 0o700 });
    const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();if(!bootPattern.test(boot))throw Error('Kernel boot identity unavailable');
    const launch={schema:2,id,boot,executable:command.executable,args:command.args??[],...(groupLock?{groupLock}:{})};
    await this.atomicJson(dir, 'command.json', launch);
    await this.atomicJson(dir, 'state.json', {schema:2,id,boot,state:'prepared',commandDigest:digest(JSON.stringify(launch)),...(groupLock?{groupLock}:{})});
    return {
      cliPath: fileURLToPath(new URL('./native-custody-launcher.mjs', import.meta.url)),
      env: { PI_COFFEE_CUSTODY_DIR: dir, PI_COFFEE_CUSTODY_ID: id },
    };
  }

  async state(): Promise<NativeCustodyState> {
    if (process.platform !== 'linux') return { state: 'unknown', reason: 'native-custody-unavailable' };
    try {
      await this.checkedDirectory(this.root);
      // The trusted personal Host can start with no prior child launches. This
      // says nothing about external writers; its source policy handles those.
      if(this.allowUnused&&(await readdir(this.root)).length===0)return {state:'quiescent'};
      const groupLock=this.groupLock?await this.readGroupLock():undefined;
      const ids = (await readdir(this.root)).filter(name=>name!=='allocation.json'&&(!groupLock||name!=='group-lock.json'));
      if (!ids.length) return { state: 'unknown', reason: 'native-custody-unestablished' };
      const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();if(!bootPattern.test(boot))throw Error('Kernel boot identity unavailable');
      let active = false;
      for (const id of ids) {
        if (!idPattern.test(id)) throw Error('Unknown custody entry');
        const dir = join(this.root, id);
        await this.checkedDirectory(dir);
        const commandText=await this.readJsonText(join(dir,'command.json')),command=JSON.parse(commandText);
        const receipt = await this.readJson(join(dir, 'state.json'));
        if (receipt.schema !== command.schema || ![1,2].includes(command.schema) || receipt.id !== id || command.id !== id) throw Error('Unknown custody receipt');
        if(command.schema===2){if(typeof command.executable!=='string'||!command.executable||!Array.isArray(command.args)||command.args.some((arg:unknown)=>typeof arg!=='string')||!bootPattern.test(command.boot)||receipt.boot!==command.boot||receipt.commandDigest!==digest(commandText)||!['prepared','active','quiescent'].includes(receipt.state))throw Error('Custody launch epoch changed');}
        else if(receipt.boot!==boot)throw Error('Legacy custody boot is unverifiable');
        if(JSON.stringify(command.groupLock)!==JSON.stringify(groupLock)||JSON.stringify(receipt.groupLock)!==JSON.stringify(groupLock))throw Error('Custody source group changed');
        if(command.schema===2&&receipt.state==='active'&&(!Number.isSafeInteger(receipt.pid)||receipt.pid<1||typeof receipt.birth!=='string'||!/^\d+$/.test(receipt.birth)))throw Error('Invalid custody process identity');
        if(command.schema===2&&receipt.state==='quiescent'&&!Number.isSafeInteger(receipt.nativeStatus))throw Error('Invalid custody completion');
        // A real kernel boot change ends prior LOCAL process lifetimes. It says
        // nothing about remote operations or source graph completeness.
        if(command.schema===2&&command.boot!==boot)continue;
        if (receipt.state === 'quiescent') continue;
        if (receipt.state !== 'active' || !Number.isSafeInteger(receipt.pid) || receipt.pid < 1 || typeof receipt.birth !== 'string') throw Error('Incomplete custody');
        const processStat = await readFile(`/proc/${receipt.pid}/stat`, 'utf8');
        const fields = processStat.slice(processStat.lastIndexOf(')') + 2).split(' ');
        if (fields[19] !== receipt.birth || fields[0] === 'Z' || fields[0] === 'X') throw Error('Custody owner changed');
        active = true;
      }
      return active ? { state: 'active', reason: 'native-writers-active' } : { state: 'quiescent' };
    } catch { return { state: 'unknown', reason: 'native-custody-incomplete' }; }
  }

  private async readGroupLock():Promise<SourceGroupLockIdentity>{
    const value=await this.readJson(join(this.root,'group-lock.json'));if(value.path!==this.groupLock)throw Error('Custody source lock mismatch');assertSourceGroupLock(value);return value;
  }
  private async bindGroupLock(){
    const value=sourceGroupLockIdentity(this.groupLock!,true),path=join(this.root,'group-lock.json');
    try{const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}const directory=await open(this.root,'r');try{await directory.sync();}finally{await directory.close();}}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    return this.readGroupLock();
  }

  private async checkedDirectory(path: string) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path) || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw Error('Custody path unavailable');
  }
  private async readJson(path:string){return JSON.parse(await this.readJsonText(path));}
  private async readJsonText(path: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw Error('Custody receipt unavailable');
    return readFile(path, 'utf8');
  }
  private async atomicJson(dir: string, name: string, value: unknown) {
    const temp = join(dir, randomUUID() + '.tmp');
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temp, join(dir, name));
    const parent = await open(dir, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
}

/** Live admission policy wrapper used by an old Host during natural handoff. */
export class AdmissionNativeCustody extends NativeWriterCustody {
 constructor(root:string,private policy:import('./managed-launch-policy.js').ManagedLaunchPolicy){super(root);}
 override async prepare(command:Parameters<NativeWriterCustody['prepare']>[0]){this.policy.assertLegacyAllowed();return super.prepare(command);}
}
