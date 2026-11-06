/** One scope's operation holds. Readers retain the existing Set view; writers own a lease. */
const owners=new WeakMap<Set<string>,Map<string,symbol>>();
export function holdTaskLifecycle(locks:Set<string>,ids:Iterable<string>,message='Task lifecycle operation in progress'):()=>void {
 const keys=[...new Set(ids)];
 if(keys.some(id=>typeof id!=='string'||!id||locks.has(id)))throw Error(message);
 let held=owners.get(locks);if(!held){held=new Map();owners.set(locks,held);}
 const owner=Symbol('task-lifecycle');
 for(const id of keys){held.set(id,owner);locks.add(id);}
 let released=false;
 return ()=>{if(released)return;released=true;for(const id of keys)if(held!.get(id)===owner){held!.delete(id);locks.delete(id);}};
}

interface IdleTask {
 readonly isBusy:boolean;
 readonly pendingUiRequests:readonly unknown[];
 backgroundState():Promise<{known:boolean;active:number}>;
 readNativeState?():Promise<{isStreaming?:boolean;isCompacting?:boolean}>;
}
/** Observe again after asynchronous reads; the held operation lease blocks new admissions. */
export async function requireTaskIdle(task:IdleTask|undefined,{native=false}:{native?:boolean}={}){
 if(!task)return;
 const busy=()=>task.isBusy||task.pendingUiRequests.length>0;
 if(busy())throw Error('Finish running and queued instructions and answer pending questions before changing this task');
 if(native){const state=await task.readNativeState?.();if(!state||state.isStreaming||state.isCompacting)throw Error('Native task is busy or unavailable');}
 const background=await task.backgroundState();
 if(!background.known||background.active)throw Error('Background work is active or unknown');
 if(busy())throw Error('Task resumed during lifecycle admission');
}
