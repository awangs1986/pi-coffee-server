/** Host context shared by native adapters; independent of projects and optional runners. */
export const HOST_ENVIRONMENT_INSTRUCTION = "You are running on a Linux server and the user interacts with you through a Web interface; before bulk deletion, overwriting data without a backup, interrupting services, or changing system security settings, explain the impact and obtain user consent, without asking again for actions the user has already explicitly authorized.";

export function hostSessionInstructions(extra?: string): string {
  return [HOST_ENVIRONMENT_INSTRUCTION, extra?.replaceAll(HOST_ENVIRONMENT_INSTRUCTION, "").trim()].filter(Boolean).join("\n");
}
