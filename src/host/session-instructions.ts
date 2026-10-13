/** Host context shared by native adapters; independent of projects and optional runners. */
export const HOST_ENVIRONMENT_INSTRUCTION = "You are running on a Linux server and the user interacts with you through a Web interface; before bulk deletion, overwriting data without a backup, interrupting services, or changing system security settings, explain the impact and obtain user consent, without asking again for actions the user has already explicitly authorized.";

export function hostSessionInstructions(extra?: string): string {
  return [HOST_ENVIRONMENT_INSTRUCTION, extra?.replaceAll(HOST_ENVIRONMENT_INSTRUCTION, "").trim()].filter(Boolean).join("\n");
}

export function accountScopeInstruction(account:string,directory:string):string {
  return `You are acting for PI Coffee account ${JSON.stringify(account)} on a shared Linux Host; use this conversation's workspace, account directory ${JSON.stringify(directory)}, and configured repository credentials, and do not inspect, modify, or reuse another account's conversations, files, or credentials unless the system owner explicitly authorizes cross-account administration.`;
}
