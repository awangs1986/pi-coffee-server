import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Host metadata only; native transcripts and authentication remain CLI-owned. */
export interface NativeSettings {model?:string;effort?:string;name?:string;}
export class NativeSettingsStore {
  private value:NativeSettings={};
  private tail:Promise<void>=Promise.resolve();
  constructor(private path?:string){}
  async load(){
    if(this.path)try{const v=JSON.parse(await readFile(this.path,'utf8'));for(const key of ['model','effort','name'] as const)if(typeof v[key]==='string')this.value[key]=v[key];}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Native task settings are unreadable; refusing to replace them with defaults');}
    return {...this.value};
  }
  async save(change:NativeSettings){
    const write=this.tail.then(async()=>{
      const next={...this.value,...change};
      if(this.path){await mkdir(dirname(this.path),{recursive:true,mode:0o700});const tmp=this.path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,this.path);}
      this.value=next;
    });this.tail=write.catch(()=>{});await write;
  }
}
