import type {AgentEngine} from '../shared/protocol.js';
import type {BackupCoordinator} from './backup.js';

interface ManagedRefreshTask {scope:string;taskId:string;engine:AgentEngine;}
/** Source-owned maintenance: one bounded low-priority capture per pass, never a
 * model call or process stop. A new writer revokes the coordinator's normal cut.
 * A sealed point is revisited after a source revision or the freshness interval.
 */
export class ManagedCheckpointRefresh {
 private timer?:ReturnType<typeof setTimeout>;private running?:Promise<void>;private stopped=true;private cursor=0;private readonly seals=new Map<string,number>();private readonly abort=new AbortController();
 constructor(private options:{coordinator:BackupCoordinator;tasks:()=>Promise<ManagedRefreshTask[]>;revision:()=>number;qualified:()=>Promise<boolean>;intervalMs?:number;refreshMs?:number}){}
 start(){if(!this.stopped)return;this.stopped=false;this.schedule(0);}
 private schedule(delay:number){this.timer=setTimeout(()=>{this.timer=undefined;void this.tick().catch(()=>undefined).finally(()=>{if(!this.stopped)this.schedule(this.options.intervalMs??60000);});},delay);this.timer.unref();}
 async tick(){if(this.abort.signal.aborted)return;if(this.running)return this.running;this.running=this.pass();try{await this.running;}finally{this.running=undefined;}}
 private async pass(){
  if(!await this.options.qualified())return;const tasks=(await this.options.tasks()).filter(task=>task.engine==='pi'||task.engine==='codex');if(!tasks.length)return;
  for(let offset=0;offset<tasks.length;offset++){
   this.abort.signal.throwIfAborted();const index=(this.cursor+offset)%tasks.length,task=tasks[index],revision=this.options.revision(),before=await this.options.coordinator.status(task.scope,task.taskId,task.engine);
   if(before.checkpointId&&this.seals.get(before.checkpointId)===revision&&before.ageMs!==null&&before.ageMs<(this.options.refreshMs??6*60*60*1000))continue;
   this.cursor=(index+1)%tasks.length;const after=await this.options.coordinator.capture(task.scope,task.taskId,task.engine,this.abort.signal);
   if(after.state==='protected'&&after.checkpointId&&after.checkpointId!==before.checkpointId){this.seals.set(after.checkpointId,revision);if(this.seals.size>4096)this.seals.delete(this.seals.keys().next().value!);}
   return;
  }
 }
 async close(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.abort.abort();await this.running?.catch(()=>undefined);}
}
