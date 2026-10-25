import {NativeWriterCustody} from './native-custody.js';
import {lstat,realpath,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';

export interface ManagedNativeProfile {
 lock:string;sourceParent:string;sources:{path:string;destination:string}[];
 runtimeRoots:string[];environment:Record<string,string>;cwd:string;
}
const within=(parent:string,path:string)=>path!==parent&&!relative(parent,path).startsWith('..')&&!isAbsolute(relative(parent,path));
const environmentKeys=new Set(['HOME','PATH','LANG','LC_ALL','TERM','NO_COLOR','PI_OFFLINE','PI_CODING_AGENT_DIR','CODEX_HOME','TMPDIR','TMP','TEMP']);
/** Concrete native launch adapter: the ordinary custody supervisor additionally
 * holds the kernel group lock and grants only validated source directory FDs to
 * a mandatory fresh kernel namespace. No unrestricted fallback is possible. */
export class ManagedNativeCustody extends NativeWriterCustody {
 readonly profile:ManagedNativeProfile;
 constructor(root:string,profile:ManagedNativeProfile){super(root);this.profile=structuredClone(profile);for(const source of this.profile.sources)Object.freeze(source);Object.freeze(this.profile.sources);Object.freeze(this.profile.runtimeRoots);Object.freeze(this.profile.environment);Object.freeze(this.profile);}
 override async prepare(command:{executable:string;args?:string[];cwd?:string;env?:Record<string,string|undefined>}){
  const parent=resolve(this.profile.sourceParent),parentInfo=await lstat(parent);
  if(!parentInfo.isDirectory()||parentInfo.isSymbolicLink()||parentInfo.uid!==process.getuid?.()||(parentInfo.mode&0o077)!==0||await realpath(parent)!==parent)throw Error('Managed source parent is not private');
  const lock=resolve(this.profile.lock);if(!within(parent,lock)||!within(parent,this.root))throw Error('Managed authority is outside its private parent');
  if(!isAbsolute(this.profile.cwd)||Object.keys(this.profile.environment).some(k=>!environmentKeys.has(k))||Object.values(this.profile.environment).some(v=>typeof v!=='string'||v.includes('\0')))throw Error('Managed native environment is unsupported');
  const sources=[];
  for(const source of this.profile.sources){
   const path=resolve(source.path),destination=resolve(source.destination),info=await lstat(path);
   if(!within(parent,path)||!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||await realpath(path)!==path||source.destination!==destination||['/','/proc','/dev','/usr','/lib','/lib64','/run','/sys'].some(p=>destination===p||p!=='/'&&destination.startsWith(p+'/'))||path===dirname(lock)||within(path,lock)||path===this.root||within(path,this.root))throw Error('Unsafe managed source grant');
   sources.push({path,destination,dev:info.dev,ino:info.ino,uid:info.uid});
  }
  if(!sources.length||sources.length>64||new Set(sources.map(s=>s.destination)).size!==sources.length)throw Error('Managed source grants are incomplete');
  const runtimeRoots=[];for(const raw of this.profile.runtimeRoots){const path=resolve(raw),info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path||path===parent||within(path,parent)||within(parent,path))throw Error('Unsafe managed runtime grant');runtimeRoots.push(path);}
  if(!isAbsolute(command.executable)||!runtimeRoots.some(root=>command.executable===root||within(root,command.executable))&&!command.executable.startsWith('/usr/'))throw Error('Managed executable is outside immutable runtime grants');
  const cwd=command.cwd??this.profile.cwd;if(!sources.some(source=>cwd===source.destination||within(source.destination,cwd)))throw Error('Managed working directory is outside source grants');
  const environment={...this.profile.environment,...Object.fromEntries(Object.entries(command.env??{}).filter(([key,value])=>['PI_OFFLINE','PI_CODING_AGENT_DIR','CODEX_HOME'].includes(key)&&typeof value==='string'))};
  const prepared=await super.prepare(command),directory=prepared.env.PI_COFFEE_CUSTODY_DIR,file=join(directory,'managed-profile.json');
  await writeFile(file,JSON.stringify({schema:1,sourceParent:parent,lock,sources,runtimeRoots,environment,cwd}),{mode:0o600,flag:'wx',flush:true});
  return {...prepared,env:{...prepared.env,PI_COFFEE_MANAGED_PROFILE:file}};
 }
}
