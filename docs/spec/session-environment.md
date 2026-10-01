# Session environment instruction

Delivery: [Server #16](https://github.com/awangs1986/pi-coffee-server/issues/16).

Every Web-managed Agent receives this English sentence at runtime:

> You are running on a Linux server and the user interacts with you through a Web interface; before bulk deletion, overwriting data without a backup, interrupting services, or changing system security settings, explain the impact and obtain user consent, without asking again for actions the user has already explicitly authorized.

Host owns this environment description. It applies to Pi Chat and Work, Codex
and Claude, independently of runner configuration. This is behavioral guidance,
not an enforced sandbox or a new tool permission. Explicit authorization remains
valid; ordinary development does not require a new approval ceremony.

Host supplies native appended/developer instructions on session start or resume,
preserving native guidance and optional runner pointers. A final Pi adapter hook
keeps the sentence after Harness filtering: Chat receives only this environment
sentence, without restoring Work prompts or runner guidance. Tool lists remain
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
