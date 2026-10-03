/** Common presentation lifecycle; command receipts map interruption to uncertainty. */
export function runLifecycle(type: unknown): 'running' | 'settled' | 'interrupted' | undefined {
  switch (type) {
    case 'agent_start': case 'run_started': return 'running';
    case 'agent_settled': case 'run_completed': return 'settled';
    case 'agent_interrupted': case 'run_interrupted': return 'interrupted';
    default: return undefined;
  }
}
