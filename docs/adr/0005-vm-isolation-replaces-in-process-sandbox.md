> Current-deployment clarification (2026-10-26): The current shared OS account does not isolate Web participants through separate VMs. Owner-managed native execution remains; per-user OS isolation is an optional deployment choice. See [current topology](../architecture/topology.md). Original decision text is retained as history.

# VM isolation replaces an in-process command sandbox

Status: accepted; deployment authority refined by [ADR-0012](./0012-owner-privileges-and-gitea-checkouts.md)

PI Coffee runs the Agent Host inside an owner-managed, isolated User VM. The MVP and 0.1 therefore do not reproduce an in-process Guard, permission approval, or command sandbox stack. Host/Pi runs as the VM owner with unrestricted passwordless sudo. VM snapshots and owner recovery are the execution safety model. Conversation checkouts and Gitea organize code; they do not constrain local execution. The sudo deployment and checkout migration still require T0–T4 acceptance.

Native-engine scope update (2026-09-23): [ADR-0013](./0013-native-agent-engines.md) extends the Host to Codex and Claude Code while preserving Pi behavior. Its explicit authentication, native-permission, history and repository boundaries govern that planned extension; this earlier Pi-specific decision does not imply native-engine support is already implemented.
