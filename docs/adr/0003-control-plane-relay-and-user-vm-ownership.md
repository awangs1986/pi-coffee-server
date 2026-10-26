> Current-deployment clarification (2026-10-26): Physical Web/User-VM separation and mandatory central Relay below are historical. Host content ownership remains a logical boundary when services share one machine. See [current topology](../architecture/topology.md). Original decision text is retained as history.

# Control Plane relays; User VM owns execution and content

Status: accepted

The Control Plane/Web VM owns browser routing, the central LLM Relay, and bounded usage metadata. Each User VM's Agent Host owns Pi execution, native transcripts, context, task files, and uploads. This keeps the upstream credential in one place and lets a browser disconnect without terminating work, while avoiding a second transcript store in the Control Plane.

Native-engine scope update (2026-09-23): [ADR-0013](./0013-native-agent-engines.md) extends the Host to Codex and Claude Code while preserving Pi behavior. Its explicit authentication, native-permission, history and repository boundaries govern that planned extension; this earlier Pi-specific decision does not imply native-engine support is already implemented.
