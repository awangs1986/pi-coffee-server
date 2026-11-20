type LifecycleKind = 'mutation' | 'artifact-import';
interface LifecycleLease { readonly kind: LifecycleKind }

/** One scope's operation holds. Writers use the existing exclusive Set view. */
const owners = new WeakMap<Set<string>, Map<string, LifecycleLease>>();

export function holdTaskLifecycle(locks: Set<string>, ids: Iterable<string>, kind: LifecycleKind = 'mutation'): () => void {
  const keys = [...new Set(ids)];
  if (keys.some(id => typeof id !== 'string' || !id || locks.has(id))) {
    throw Error('Task lifecycle operation in progress');
  }
  let held = owners.get(locks);
  if (!held) {
    held = new Map();
    owners.set(locks, held);
  }
  const scope = held;
  const lease = { kind };
  for (const id of keys) {
    scope.set(id, lease);
    locks.add(id);
  }
  return () => {
    for (const id of keys) {
      if (scope.get(id) !== lease) continue;
      scope.delete(id);
      locks.delete(id);
    }
  };
}

/** Image imports protect the workspace and binding without pausing the Agent. */
export function blocksTaskInteraction(locks: Set<string>, id: string): boolean {
  return locks.has(id) && owners.get(locks)?.get(id)?.kind !== 'artifact-import';
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
