> 2026-10-01 amendment: blanket engine immutability is superseded only by [explicit Work Pi/Codex takeover](../spec/agent-takeover.md). Chat cannot upgrade or switch. The rest of this dated decision remains applicable.

# Native agent engines behind the existing Host boundary

Status: accepted, 2026-09-23. M0–M5 implemented, merged and deployed on the two dedicated User VMs and separate Web host.

Implementation evidence: [M0–M4 review](../reviews/native-agents-m0-m4-20260923.md) and [M5 deployment evidence](../reviews/native-agents-m5-20260923.md).

PI Coffee supports the user's native Codex and Claude Code installations alongside Pi through engine-specific Host Adapters. The existing Browser Shell, Gitea identity and code collaboration, User VM ownership, Conversation Workspaces and transparent Web Server remain shared; Pi's prompts, Chat/Work policy, LSP, tools, plugins and context customizations remain exclusive to Pi. This preserves native engine behavior and user authentication while accepting the cost of explicit capability and lifecycle mapping instead of forcing every engine into Pi's semantics.

## Consequences and prior decisions

- Extend ADR-0001 and ADR-0011 from one Pi Adapter to multiple engine Adapters in the Agent Runtime repository; the Server still does not own execution or parse the native protocols.
- Scope ADR-0003's central model Relay/credential requirement to the existing Pi Relay route. Codex and Claude Code use their own supported authentication and upstream settings in the User VM; the platform does not extract or route subscription credentials.
- Preserve ADR-0005 and ADR-0012's trusted VM owner and lack of a platform command sandbox. This does not disable another engine's native permissions, approvals or sandbox configuration, nor authorize automatic bypass settings.
- Extend ADR-0006's independent Session lifetime to every engine and ADR-0008's native-history authority to each engine's own native store. Pi's existing storage remains unchanged; no central transcript store or cross-engine history conversion is introduced.
- Preserve ADR-0012's independent Checkout and Gitea PR design. A Conversation additionally binds to one immutable engine and native Session identity; native background-work state must participate in the existing lifecycle guards.
- The native Claude CLI route keeps the official binary and official user authentication intact. An SDK product with subscription-token authentication is not a substitute. Open source and personal account ownership do not themselves establish permission for every integration method.

The maintained [native-engine SPEC](../spec/native-agent-engines.md) defines requirements, capabilities, compatibility, acceptance and non-goals. Existing Pi behavior stays supported throughout the migration.
