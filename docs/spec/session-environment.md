# Session environment instruction

Delivery: [Server #16](https://github.com/awangs1986/pi-coffee-server/issues/16).

Every Web-managed Work Agent receives this English sentence at runtime:

> You are running on a Linux server and the user interacts with you through a Web interface; before bulk deletion, overwriting data without a backup, interrupting services, or changing system security settings, explain the impact and obtain user consent, without asking again for actions the user has already explicitly authorized.

Host owns this environment description. It applies to Pi Work and the native Work engines, independently of runner
configuration. Ordinary Pi Chat is excluded. This is behavioral guidance,
not an enforced sandbox or a new tool permission. Explicit authorization remains
valid; ordinary development does not require a new approval ceremony.

Host supplies native appended/developer instructions on session start or resume,
preserving native guidance and optional runner pointers. A final Pi adapter hook
keeps the sentence for Work after Harness filtering. For Chat it instead removes
system/developer messages and provider system-instruction fields. Tool lists remain
unchanged. Consecutive turns, resume and Codex context-preset rebinding must not
accumulate copies. The authoritative text is `src/host/session-instructions.ts`.

No project AGENTS.md/CLAUDE.md, native installation file or historical transcript
is rewritten. Existing running processes are not interrupted; they receive the
change after their next native start/resume under the updated Host. The Pi hook
uses native extension events, with provider-payload coverage for OpenAI,
Anthropic, Bedrock and Google formats. Future transport changes must retain this
acceptance boundary.

Verification includes native launch/resume arguments for Codex/Claude, actual Pi
Chat/Work provider requests through the installed Harness across repeated turns
and resume, unchanged Chat tools, and the Web/Host HTTP/WS integration test.
Model compliance with the sentence is not a guaranteed security boundary.

## Chat zero-system boundary — 2026-10-05

The owner's current decision supersedes the earlier Chat environment-sentence
exception and account-wide Chat runner injection. Ordinary Chat has zero system
instructions and receives no automatic Host-environment, project/Fork or test-server
guidance. The authoritative selector is the Conversation workspace kind, including
when the native ID changes after clear-context. Host sends runner context only to
known Work workspaces; unknown task kinds fail closed.

Pi Chat ignores native appended Host instructions, clears before-agent system text,
and filters system/developer fields at the final provider seam. The filter preserves
user, assistant and tool content and native tool declarations. It also applies when
optional Harness packages are absent in emergency mode. Explicitly supplied user
instructions, attachments and requested SSHME context are not rewritten.

New Chat, reset Chat, queued delivery and Host restart share this boundary. Work
retains its existing environment sentence and configured runner revision updates.
Original transcripts are never rewritten and existing conversations are not silently
cleared; after activation, a previously contaminated Chat needs one explicit clear
(or a new Chat) to remove old user-turn injections already in its native history.
